import { createHash } from 'node:crypto'
import { v7 as uuidv7 } from 'uuid'
import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common'
import { getDbPool } from '@barghsa/db'
import { ErrorCodes } from '@barghsa/shared/errors'
import {
  BANK_RECEIPT_CONFIRM_ERRORS,
  BANK_RECEIPT_CONFIRMED_EVENT,
  BANK_RECEIPT_CREDIT_DESCRIPTION,
  BANK_RECEIPT_REJECTED_EVENT,
  BANK_RECEIPT_TOPUP_CHANNEL,
  bankReceiptCreditIdempotencyKey,
  bankReceiptCreditMetadata,
  bankReceiptStaffDecisionMetadata,
  isBankReceiptChannel,
  isPendingBankReceiptTopUp,
  parseBankReceiptRejectReason,
  readBankReceiptStaffDecision,
  type BankReceiptStaffDecisionSnapshot,
  type BankReceiptTopUpDetails,
} from '@barghsa/shared/finance'
import type { StorageProvider } from '@barghsa/shared/storage'
import { STORAGE_PROVIDER } from '../storage/storage.constants.js'
import { WalletService, type TransactionRow, type WalletQueryClient } from './wallet.service.js'

const ATTACHMENT_URL_TTL_SECONDS = 15 * 60

interface LedgerRow {
  id: string
  wallet_id: string
  type: string
  amount: string | number | bigint
  state: string
  idempotency_key: string
  ref_id?: string | null
  description?: string | null
  metadata?: unknown
  receipt_attachment_key?: string | null
  created_at: Date
  updated_at: Date
}

/** Public DTO for the staff review UI. */
export interface BankReceiptReviewDto {
  transactionId: string
  walletId: string
  amount: string
  currency: 'IRR'
  state: string
  paymentDate: string | null
  payerReference: string | null
  attachmentKey: string | null
  attachmentUrl: string | null
  customerNote: string | null
  submittedAt: string
  canDecide: boolean
  staffDecision: BankReceiptStaffDecisionSnapshot | null
  creditTransactionId: string | null
  auditId?: string
}

export interface ConfirmBankReceiptInput {
  transactionId: string
  actorUserId: string
  ip: string
  correlationId?: string
  now?: Date
}

export interface RejectBankReceiptInput {
  transactionId: string
  raw: unknown
  actorUserId: string
  ip: string
  correlationId?: string
  now?: Date
}

/**
 * Staff confirmation of bank-receipt wallet top-ups (T-04.2.02.04).
 *
 * Confirm (one DB transaction):
 *   1. Lock the Pending `topup` ledger row.
 *   2. Credit the wallet via `WalletService.credit()` on this client
 *      with a derived idempotency key (posted balance comes only from
 *      the Completed row).
 *   3. Release the Pending intent and append an audit row.
 *   Credit, pending release, and audit commit or roll back together.
 *
 * Reject: mark the Pending row `Rejected` with a customer-visible reason
 * and never call credit. Rejected submissions never increase balance.
 */
@Injectable()
export class BankReceiptConfirmationService {
  private readonly logger = new Logger(BankReceiptConfirmationService.name)

  constructor(
    private readonly walletService: WalletService,
    @Optional()
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProvider | null = null,
  ) {}

  async listPending(): Promise<BankReceiptReviewDto[]> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT *
         FROM wallet_transactions
        WHERE type = 'topup'
          AND state = 'Pending'
          AND receipt_attachment_key IS NOT NULL
          AND metadata->>'channel' = $1
        ORDER BY created_at ASC`,
      [BANK_RECEIPT_TOPUP_CHANNEL],
    )
    const items: BankReceiptReviewDto[] = []
    for (const row of result.rows as LedgerRow[]) {
      items.push(await this.toDto(row))
    }
    return items
  }

  async get(transactionId: string): Promise<BankReceiptReviewDto> {
    const pool = getDbPool()
    const result = await pool.query(`SELECT * FROM wallet_transactions WHERE id = $1`, [
      transactionId,
    ])
    const row = (result.rows as LedgerRow[])[0]
    if (!row || !isBankReceiptChannel(row.metadata)) {
      httpError(
        ErrorCodes.NOT_FOUND_RESOURCE.code,
        `Bank receipt top-up not found: ${transactionId}`,
        404,
      )
    }
    return this.toDto(row)
  }

  async confirm(input: ConfirmBankReceiptInput): Promise<BankReceiptReviewDto> {
    const now = input.now ?? new Date()
    const pool = getDbPool()
    const client = await pool.connect()
    const lockKeys = bankReceiptConfirmationLockKeys(input.transactionId)
    try {
      await client.query('SELECT pg_advisory_lock($1, $2)', lockKeys)
      try {
        await client.query('BEGIN')
        const pending = await this.lockBankReceipt(client, input.transactionId)

        if (pending.state === 'Released') {
          const existing = await this.findExistingCredit(pending.id)
          if (!existing) {
            await client.query('ROLLBACK')
            httpError(
              ErrorCodes.CONFLICT_STATE.code,
              BANK_RECEIPT_CONFIRM_ERRORS.NOT_PENDING(pending.state),
              409,
            )
          }
          await client.query('COMMIT')
          return this.toDto(pending, {
            creditTransactionId: existing.id,
          })
        }

        if (pending.state === 'Rejected') {
          await client.query('ROLLBACK')
          httpError(
            ErrorCodes.CONFLICT_STATE.code,
            BANK_RECEIPT_CONFIRM_ERRORS.ALREADY_REJECTED(),
            409,
          )
        }

        if (!isPendingBankReceiptTopUp(pending)) {
          await client.query('ROLLBACK')
          httpError(
            ErrorCodes.CONFLICT_STATE.code,
            BANK_RECEIPT_CONFIRM_ERRORS.NOT_PENDING(pending.state),
            409,
          )
        }

        const receipt = readReceiptDetails(pending.metadata)
        const credit = await this.walletService.credit(
          pending.walletId,
          pending.amount,
          {
            type: 'topup',
            refId: pending.id,
            description: BANK_RECEIPT_CREDIT_DESCRIPTION,
            metadata: bankReceiptCreditMetadata({
              pendingTransactionId: pending.id,
              confirmedBy: input.actorUserId,
              confirmedAt: now,
              receipt,
            }),
          },
          bankReceiptCreditIdempotencyKey(pending.id),
          client,
        )

        const decision = bankReceiptStaffDecisionMetadata({
          decision: 'confirmed',
          actorUserId: input.actorUserId,
          decidedAt: now,
          creditTransactionId: credit.id,
        })
        const updated = await this.releasePending(
          client,
          pending.id,
          decision,
        )
        const auditId = await this.recordAudit(client, {
          event: BANK_RECEIPT_CONFIRMED_EVENT,
          actorUserId: input.actorUserId,
          ip: input.ip,
          correlationId: input.correlationId,
          metadata: {
            transactionId: pending.id,
            walletId: pending.walletId,
            amount: pending.amount.toString(),
            creditTransactionId: credit.id,
            previousState: 'Pending',
            newState: 'Released',
          },
          occurredAt: now,
        })
        await client.query('COMMIT')

        this.logger.log(
          `Bank receipt top-up ${pending.id} credited as ${credit.id} for wallet ${pending.walletId}`,
        )
        return this.toDto(updated ?? pending, {
          creditTransactionId: credit.id,
          auditId,
        })
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        await client.query('SELECT pg_advisory_unlock($1, $2)', lockKeys)
      }
    } finally {
      client.release()
    }
  }

  async reject(input: RejectBankReceiptInput): Promise<BankReceiptReviewDto> {
    const parsed = parseBankReceiptRejectReason(input.raw)
    if (!parsed.ok) {
      httpError(ErrorCodes.VALIDATION_INPUT_INVALID.code, parsed.message, 400)
    }

    const now = input.now ?? new Date()
    const pool = getDbPool()
    const client = await pool.connect()
    const lockKeys = bankReceiptConfirmationLockKeys(input.transactionId)
    try {
      await client.query('SELECT pg_advisory_lock($1, $2)', lockKeys)
      try {
        await client.query('BEGIN')
        const pending = await this.lockBankReceipt(client, input.transactionId)

        if (pending.state === 'Rejected') {
          const existing = readBankReceiptStaffDecision(pending.metadata)
          if (existing?.reason === parsed.reason) {
            await client.query('COMMIT')
            return this.toDto(pending)
          }
          await client.query('ROLLBACK')
          httpError(
            ErrorCodes.CONFLICT_STATE.code,
            BANK_RECEIPT_CONFIRM_ERRORS.ALREADY_REJECTED(),
            409,
          )
        }

        if (pending.state === 'Released') {
          await client.query('ROLLBACK')
          httpError(
            ErrorCodes.CONFLICT_STATE.code,
            BANK_RECEIPT_CONFIRM_ERRORS.ALREADY_CONFIRMED(),
            409,
          )
        }

        if (!isPendingBankReceiptTopUp(pending)) {
          await client.query('ROLLBACK')
          httpError(
            ErrorCodes.CONFLICT_STATE.code,
            BANK_RECEIPT_CONFIRM_ERRORS.NOT_PENDING(pending.state),
            409,
          )
        }

        const decision = bankReceiptStaffDecisionMetadata({
          decision: 'rejected',
          actorUserId: input.actorUserId,
          decidedAt: now,
          reason: parsed.reason,
        })
        const updated = await this.markRejected(client, pending.id, decision)
        const auditId = await this.recordAudit(client, {
          event: BANK_RECEIPT_REJECTED_EVENT,
          actorUserId: input.actorUserId,
          ip: input.ip,
          correlationId: input.correlationId,
          metadata: {
            transactionId: pending.id,
            walletId: pending.walletId,
            amount: pending.amount.toString(),
            reason: parsed.reason,
            customerVisible: true,
            previousState: 'Pending',
            newState: 'Rejected',
          },
          occurredAt: now,
        })
        await client.query('COMMIT')

        this.logger.log(
          `Bank receipt top-up ${pending.id} rejected for wallet ${pending.walletId}`,
        )
        return this.toDto(updated ?? pending, { auditId })
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        await client.query('SELECT pg_advisory_unlock($1, $2)', lockKeys)
      }
    } finally {
      client.release()
    }
  }

  private async lockBankReceipt(
    client: WalletQueryClient,
    transactionId: string,
  ): Promise<LedgerRow & { walletId: string; amount: bigint }> {
    const result = await client.query(
      `SELECT * FROM wallet_transactions WHERE id = $1 FOR UPDATE`,
      [transactionId],
    )
    const row = (result.rows as LedgerRow[])[0]
    if (!row || !isBankReceiptChannel(row.metadata)) {
      httpError(
        ErrorCodes.NOT_FOUND_RESOURCE.code,
        `Bank receipt top-up not found: ${transactionId}`,
        404,
      )
    }
    return {
      ...row,
      walletId: row.wallet_id,
      amount: BigInt(row.amount),
    }
  }

  private async findExistingCredit(pendingId: string): Promise<TransactionRow | null> {
    const pool = getDbPool()
    const result = await pool.query(`SELECT * FROM wallet_transactions WHERE idempotency_key = $1`, [
      bankReceiptCreditIdempotencyKey(pendingId),
    ])
    if (result.rows.length === 0) return null
    return mapTransaction(result.rows[0] as LedgerRow)
  }

  private async releasePending(
    client: WalletQueryClient,
    pendingId: string,
    decision: Record<string, unknown>,
  ): Promise<LedgerRow | null> {
    const result = await client.query(
      `UPDATE wallet_transactions
          SET state = 'Released',
              metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
              updated_at = NOW()
        WHERE id = $1
          AND type = 'topup'
          AND state = 'Pending'
        RETURNING *`,
      [pendingId, JSON.stringify(decision)],
    )
    return (result.rows as LedgerRow[])[0] ?? null
  }

  private async markRejected(
    client: WalletQueryClient,
    pendingId: string,
    decision: Record<string, unknown>,
  ): Promise<LedgerRow | null> {
    const result = await client.query(
      `UPDATE wallet_transactions
          SET state = 'Rejected',
              metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
              updated_at = NOW()
        WHERE id = $1
          AND type = 'topup'
          AND state = 'Pending'
        RETURNING *`,
      [pendingId, JSON.stringify(decision)],
    )
    return (result.rows as LedgerRow[])[0] ?? null
  }

  private async recordAudit(
    client: WalletQueryClient,
    entry: {
      event: string
      actorUserId: string
      ip: string
      correlationId?: string | undefined
      metadata: Record<string, unknown>
      occurredAt: Date
    },
  ): Promise<string> {
    const auditId = uuidv7()
    await client.query(
      `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        auditId,
        entry.actorUserId,
        entry.event,
        JSON.stringify(entry.metadata),
        entry.correlationId ?? null,
        entry.ip,
        entry.occurredAt,
      ],
    )
    return auditId
  }

  private async toDto(
    row: LedgerRow,
    extra: { creditTransactionId?: string | null; auditId?: string } = {},
  ): Promise<BankReceiptReviewDto> {
    const receipt = readReceiptDetails(row.metadata)
    const attachmentKey =
      row.receipt_attachment_key ?? receipt?.attachmentKey ?? null
    const staffDecision = readBankReceiptStaffDecision(row.metadata)
    const creditTransactionId =
      extra.creditTransactionId ?? staffDecision?.creditTransactionId ?? null
    return {
      transactionId: row.id,
      walletId: row.wallet_id,
      amount: BigInt(row.amount).toString(),
      currency: 'IRR',
      state: row.state,
      paymentDate: receipt?.paymentDate ?? null,
      payerReference: receipt?.payerReference ?? null,
      attachmentKey,
      attachmentUrl: await this.signAttachmentUrl(attachmentKey),
      customerNote: receipt?.customerNote ?? null,
      submittedAt: toIso(row.created_at),
      canDecide: row.state === 'Pending',
      staffDecision,
      creditTransactionId,
      ...(extra.auditId ? { auditId: extra.auditId } : {}),
    }
  }

  private async signAttachmentUrl(attachmentKey: string | null): Promise<string | null> {
    if (!attachmentKey || !this.storage) return null
    try {
      return await this.storage.presignedGetUrl(attachmentKey, ATTACHMENT_URL_TTL_SECONDS)
    } catch (error) {
      this.logger.warn(
        `Could not sign bank-receipt attachment ${attachmentKey}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      )
      return null
    }
  }
}

export function bankReceiptConfirmationLockKeys(transactionId: string): [number, number] {
  const digest = createHash('sha256')
    .update(`wallet-bank-receipt-confirm:${transactionId}`)
    .digest()
  return [digest.readInt32BE(0), digest.readInt32BE(4)]
}

function readReceiptDetails(metadata: unknown): BankReceiptTopUpDetails | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const receipt = (metadata as { receipt?: unknown }).receipt
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return null
  const record = receipt as Record<string, unknown>
  if (typeof record.paymentDate !== 'string') return null
  if (typeof record.payerReference !== 'string') return null
  if (typeof record.attachmentKey !== 'string') return null
  return {
    paymentDate: record.paymentDate,
    payerReference: record.payerReference,
    attachmentKey: record.attachmentKey,
    customerNote: typeof record.customerNote === 'string' ? record.customerNote : null,
  }
}

function mapTransaction(row: LedgerRow): TransactionRow {
  return {
    id: row.id,
    walletId: row.wallet_id,
    type: row.type,
    amount: BigInt(row.amount),
    state: row.state,
    idempotencyKey: row.idempotency_key,
    refId: row.ref_id ?? null,
    description: row.description ?? null,
    metadata: row.metadata ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString()
}

function httpError(code: string, message: string, statusCode: number): never {
  throw new HttpException({ statusCode, error: code, message }, statusCode)
}
