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
  BANK_RECEIPT_OVERPAYMENT_CREDIT_DESCRIPTION,
  BANK_RECEIPT_OVERPAYMENT_ERRORS,
  BANK_RECEIPT_REJECTED_EVENT,
  BANK_RECEIPT_TOPUP_CHANNEL,
  allocateReceiptAgainstInvoice,
  bankReceiptCreditIdempotencyKey,
  bankReceiptCreditMetadata,
  bankReceiptOverpaymentCreditIdempotencyKey,
  bankReceiptOverpaymentCreditMetadata,
  bankReceiptOverpaymentSnapshot,
  bankReceiptStaffDecisionMetadata,
  invoiceStateAfterBankReceiptAllocation,
  isBankReceiptChannel,
  isPendingBankReceiptTopUp,
  parseBankReceiptRejectReason,
  readBankReceiptOverpaymentSnapshot,
  readBankReceiptStaffDecision,
  remainingForBankReceiptSettlement,
  type BankReceiptOverpaymentSnapshot,
  type BankReceiptStaffDecisionSnapshot,
  type BankReceiptTopUpDetails,
} from '@barghsa/shared/finance'
import type { StorageProvider } from '@barghsa/shared/storage'
import { STORAGE_PROVIDER } from '../storage/storage.constants.js'
import { InvoiceAuditRepository } from '../invoice/invoice-audit.repository.js'
import { InvoiceStateMachineService } from '../invoice/invoice-state-machine.service.js'
import {
  isInvoiceState,
  type InvoiceState,
} from '../invoice/invoice-state.model.js'
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

interface InvoiceRow {
  id: string
  profile_id: string
  state: string
  total_amount: string | number | bigint
  paid_amount: string | number | bigint
  refunded_amount: string | number | bigint
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
  overpayment: BankReceiptOverpaymentSnapshot | null
  auditId?: string
}

export interface BankReceiptAllocationPreviewDto {
  transactionId: string
  invoiceId: string
  invoiceState: string
  receiptAmount: string
  remaining: string
  invoiceAllocation: string
  walletCreditAmount: string
  isOverpayment: boolean
}

export interface ConfirmBankReceiptInput {
  transactionId: string
  actorUserId: string
  ip: string
  invoiceId?: string | null
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
 * Staff confirmation of bank-receipt wallet top-ups (T-04.2.02.04)
 * and invoice overpayment handling (T-04.2.02.05).
 *
 * Confirm (one DB transaction):
 *   1. Lock the Pending `topup` ledger row.
 *   2. When no invoice is supplied, credit the full receipt via
 *      `WalletService.credit()` with the top-up idempotency key.
 *   3. When an invoice is supplied: lock it, allocate
 *      `min(receipt, remaining)` onto `paid_amount` (never over-settle),
 *      transition the invoice through the validated ConfirmBankReceipt
 *      path (SubmitBankReceipt into PaymentUnderReview when needed, then
 *      confirm to Paid or PartiallyFunded, setting paid_at on full
 *      settlement), and credit only the excess via a *separate*
 *      `WalletService.credit()` with
 *      `bankReceiptOverpaymentCreditIdempotencyKey`.
 *   4. Release the Pending intent and append an audit row.
 *   Credit, invoice allocation, state transition, pending release, and
 *   audit commit or roll back together.
 *
 * Reject: mark the Pending row `Rejected` with a customer-visible reason
 * and never call credit. Rejected submissions never increase balance.
 */
@Injectable()
export class BankReceiptConfirmationService {
  private readonly logger = new Logger(BankReceiptConfirmationService.name)
  private readonly invoiceStateMachine: InvoiceStateMachineService

  constructor(
    private readonly walletService: WalletService,
    @Optional()
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProvider | null = null,
    @Optional()
    invoiceStateMachine?: InvoiceStateMachineService,
  ) {
    this.invoiceStateMachine =
      invoiceStateMachine ?? new InvoiceStateMachineService(new InvoiceAuditRepository())
  }

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

  async previewAllocation(
    transactionId: string,
    invoiceId: string,
  ): Promise<BankReceiptAllocationPreviewDto> {
    const pool = getDbPool()
    const receiptResult = await pool.query(`SELECT * FROM wallet_transactions WHERE id = $1`, [
      transactionId,
    ])
    const receipt = (receiptResult.rows as LedgerRow[])[0]
    if (!receipt || !isBankReceiptChannel(receipt.metadata)) {
      httpError(
        ErrorCodes.NOT_FOUND_RESOURCE.code,
        `Bank receipt top-up not found: ${transactionId}`,
        404,
      )
    }
    const invoiceResult = await pool.query(
      `SELECT id, profile_id, state, total_amount, paid_amount, refunded_amount FROM invoices WHERE id = $1`,
      [invoiceId],
    )
    const invoice = (invoiceResult.rows as InvoiceRow[])[0]
    if (!invoice) {
      httpError(ErrorCodes.NOT_FOUND_RESOURCE.code, `Invoice not found: ${invoiceId}`, 404)
    }
    if (invoice.profile_id !== receipt.wallet_id) {
      httpError(
        ErrorCodes.CONFLICT_STATE.code,
        BANK_RECEIPT_OVERPAYMENT_ERRORS.PROFILE_MISMATCH(),
        409,
      )
    }
    const remaining = remainingForBankReceiptSettlement({
      totalAmount: BigInt(invoice.total_amount),
      paidAmount: BigInt(invoice.paid_amount),
      state: invoice.state,
    })
    const allocation = allocateReceiptAgainstInvoice({
      receiptAmount: BigInt(receipt.amount),
      remaining,
    })
    return {
      transactionId: receipt.id,
      invoiceId: invoice.id,
      invoiceState: invoice.state,
      receiptAmount: BigInt(receipt.amount).toString(),
      remaining: remaining.toString(),
      invoiceAllocation: allocation.invoiceAllocation.toString(),
      walletCreditAmount: allocation.walletCreditAmount.toString(),
      isOverpayment: allocation.isOverpayment,
    }
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
          const existingOverpayment = await this.findExistingOverpaymentCredit(pending.id)
          const overpayment = readBankReceiptOverpaymentSnapshot(pending.metadata)
          if (!existing && !existingOverpayment && !overpayment) {
            await client.query('ROLLBACK')
            httpError(
              ErrorCodes.CONFLICT_STATE.code,
              BANK_RECEIPT_CONFIRM_ERRORS.NOT_PENDING(pending.state),
              409,
            )
          }
          await client.query('COMMIT')
          return this.toDto(pending, {
            creditTransactionId: existing?.id ?? existingOverpayment?.id ?? null,
            overpayment,
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
        const invoiceId = input.invoiceId ?? null
        let creditId: string | null = null
        let overpayment: BankReceiptOverpaymentSnapshot | null = null

        if (invoiceId) {
          const applied = await this.applyInvoiceLinkedConfirm(client, {
            pending,
            invoiceId,
            actorUserId: input.actorUserId,
            ip: input.ip,
            ...(input.correlationId !== undefined
              ? { correlationId: input.correlationId }
              : {}),
            confirmedAt: now,
          })
          creditId = applied.creditId
          overpayment = applied.overpayment
        } else {
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
          creditId = credit.id
        }

        const decision = {
          ...bankReceiptStaffDecisionMetadata({
            decision: 'confirmed',
            actorUserId: input.actorUserId,
            decidedAt: now,
            creditTransactionId: creditId,
          }),
          ...(overpayment ? { overpayment } : {}),
        }
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
            creditTransactionId: creditId,
            previousState: 'Pending',
            newState: 'Released',
            ...(overpayment
              ? {
                  invoiceId: overpayment.invoiceId,
                  invoiceAllocation: overpayment.invoiceAllocation,
                  walletCreditAmount: overpayment.walletCreditAmount,
                  remainingBefore: overpayment.remainingBefore,
                  overpaymentCreditTransactionId: overpayment.overpaymentCreditTransactionId,
                }
              : {}),
          },
          occurredAt: now,
        })
        await client.query('COMMIT')

        this.logger.log(
          invoiceId
            ? `Bank receipt ${pending.id} allocated to invoice ${invoiceId}; wallet excess ${overpayment?.walletCreditAmount ?? '0'}`
            : `Bank receipt top-up ${pending.id} credited as ${creditId} for wallet ${pending.walletId}`,
        )
        return this.toDto(updated ?? pending, {
          creditTransactionId: creditId,
          overpayment,
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

  private async applyInvoiceLinkedConfirm(
    client: WalletQueryClient,
    input: {
      pending: LedgerRow & { walletId: string; amount: bigint }
      invoiceId: string
      actorUserId: string
      ip: string
      correlationId?: string
      confirmedAt: Date
    },
  ): Promise<{ creditId: string | null; overpayment: BankReceiptOverpaymentSnapshot }> {
    const invoice = await this.lockInvoice(client, input.invoiceId)
    if (invoice.profile_id !== input.pending.walletId) {
      httpError(
        ErrorCodes.CONFLICT_STATE.code,
        BANK_RECEIPT_OVERPAYMENT_ERRORS.PROFILE_MISMATCH(),
        409,
      )
    }
    const remaining = remainingForBankReceiptSettlement({
      totalAmount: BigInt(invoice.total_amount),
      paidAmount: BigInt(invoice.paid_amount),
      state: invoice.state,
    })
    const allocation = allocateReceiptAgainstInvoice({
      receiptAmount: input.pending.amount,
      remaining,
    })

    if (allocation.invoiceAllocation > 0n) {
      await this.applyInvoiceAllocation(client, invoice.id, allocation.invoiceAllocation)
      await this.confirmInvoiceAfterAllocation(client, {
        invoice,
        paidAfter: BigInt(invoice.paid_amount) + allocation.invoiceAllocation,
        actorUserId: input.actorUserId,
        ip: input.ip,
        ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
        now: input.confirmedAt,
      })
    }

    let overpaymentCreditId: string | null = null
    if (allocation.walletCreditAmount > 0n) {
      const credit = await this.walletService.credit(
        input.pending.walletId,
        allocation.walletCreditAmount,
        {
          type: 'topup',
          refId: input.pending.id,
          description: BANK_RECEIPT_OVERPAYMENT_CREDIT_DESCRIPTION,
          metadata: bankReceiptOverpaymentCreditMetadata({
            pendingTransactionId: input.pending.id,
            invoiceId: invoice.id,
            confirmedBy: input.actorUserId,
            confirmedAt: input.confirmedAt,
            invoiceAllocation: allocation.invoiceAllocation,
            walletCreditAmount: allocation.walletCreditAmount,
            remainingBefore: remaining,
          }),
        },
        bankReceiptOverpaymentCreditIdempotencyKey(input.pending.id),
        client,
      )
      overpaymentCreditId = credit.id
    }

    return {
      creditId: overpaymentCreditId,
      overpayment: bankReceiptOverpaymentSnapshot({
        invoiceId: invoice.id,
        remainingBefore: remaining,
        invoiceAllocation: allocation.invoiceAllocation,
        walletCreditAmount: allocation.walletCreditAmount,
        overpaymentCreditTransactionId: overpaymentCreditId,
      }),
    }
  }

  private async lockInvoice(client: WalletQueryClient, invoiceId: string): Promise<InvoiceRow> {
    const result = await client.query(
      `SELECT id, profile_id, state, total_amount, paid_amount, refunded_amount
         FROM invoices
        WHERE id = $1
        FOR UPDATE`,
      [invoiceId],
    )
    const row = (result.rows as InvoiceRow[])[0]
    if (!row) {
      httpError(ErrorCodes.NOT_FOUND_RESOURCE.code, `Invoice not found: ${invoiceId}`, 404)
    }
    return row
  }

  private async applyInvoiceAllocation(
    client: WalletQueryClient,
    invoiceId: string,
    allocation: bigint,
  ): Promise<void> {
    const result = await client.query(
      `UPDATE invoices
          SET paid_amount = paid_amount + $2::bigint,
              updated_at = NOW()
        WHERE id = $1
          AND paid_amount + $2::bigint <= total_amount
        RETURNING id`,
      [invoiceId, allocation.toString()],
    )
    if (result.rows.length === 0) {
      httpError(
        ErrorCodes.CONFLICT_STATE.code,
        BANK_RECEIPT_OVERPAYMENT_ERRORS.CANNOT_OVERSETTLE(),
        409,
      )
    }
  }

  /**
   * After paid_amount is incremented, take the validated ConfirmBankReceipt
   * path so state and paid_at match the post-allocation amount.
   * Unpaid / PartiallyFunded / Overdue first SubmitBankReceipt into
   * PaymentUnderReview; ConfirmBankReceipt then lands on Paid or
   * PartiallyFunded and sets paid_at on full settlement.
   */
  private async confirmInvoiceAfterAllocation(
    client: WalletQueryClient,
    input: {
      invoice: InvoiceRow
      paidAfter: bigint
      actorUserId: string
      ip: string
      correlationId?: string
      now: Date
    },
  ): Promise<void> {
    if (!isInvoiceState(input.invoice.state)) {
      httpError(
        ErrorCodes.CONFLICT_STATE.code,
        `Invoice ${input.invoice.id} is in an unknown state: ${input.invoice.state}`,
        409,
      )
    }
    const totalAmount = BigInt(input.invoice.total_amount)
    const destination = invoiceStateAfterBankReceiptAllocation({
      paidAmount: input.paidAfter,
      totalAmount,
    })
    const financials = {
      paidAmount: input.paidAfter,
      totalAmount,
      refundedAmount: BigInt(input.invoice.refunded_amount),
      incomingPaidAmount: input.paidAfter,
    }
    const transitionOpts = {
      actorUserId: input.actorUserId,
      ip: input.ip,
      ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
      now: input.now,
      client,
      financials,
    }

    let from: InvoiceState = input.invoice.state
    if (from !== 'PaymentUnderReview') {
      await this.invoiceStateMachine.transition(
        input.invoice.id,
        from,
        'PaymentUnderReview',
        {
          ...transitionOpts,
          reason: 'Bank receipt applied to invoice',
        },
      )
      from = 'PaymentUnderReview'
    }

    await this.invoiceStateMachine.transition(input.invoice.id, from, destination, {
      ...transitionOpts,
      reason: 'Bank receipt confirmed against invoice',
    })
  }

  private async findExistingCredit(pendingId: string): Promise<TransactionRow | null> {
    const pool = getDbPool()
    const result = await pool.query(`SELECT * FROM wallet_transactions WHERE idempotency_key = $1`, [
      bankReceiptCreditIdempotencyKey(pendingId),
    ])
    if (result.rows.length === 0) return null
    return mapTransaction(result.rows[0] as LedgerRow)
  }

  private async findExistingOverpaymentCredit(pendingId: string): Promise<TransactionRow | null> {
    const pool = getDbPool()
    const result = await pool.query(`SELECT * FROM wallet_transactions WHERE idempotency_key = $1`, [
      bankReceiptOverpaymentCreditIdempotencyKey(pendingId),
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
    extra: {
      creditTransactionId?: string | null
      overpayment?: BankReceiptOverpaymentSnapshot | null
      auditId?: string
    } = {},
  ): Promise<BankReceiptReviewDto> {
    const receipt = readReceiptDetails(row.metadata)
    const attachmentKey =
      row.receipt_attachment_key ?? receipt?.attachmentKey ?? null
    const staffDecision = readBankReceiptStaffDecision(row.metadata)
    const overpayment =
      extra.overpayment ?? readBankReceiptOverpaymentSnapshot(row.metadata)
    const creditTransactionId =
      extra.creditTransactionId ??
      staffDecision?.creditTransactionId ??
      overpayment?.overpaymentCreditTransactionId ??
      null
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
      overpayment,
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
