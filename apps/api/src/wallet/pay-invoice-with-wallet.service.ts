/**
 * PayInvoiceWithWalletService — settle an invoice with a single full
 * wallet debit (T-04.2.03.01 / T-04.2.03.02 / T-04.2.03.03 / S-04.2.03).
 *
 * `payInvoiceWithWallet(invoiceId, profileId, idempotencyKey)`:
 *   1. Validates UUIDs and a non-blank idempotency key.
 *   2. Opens one DB transaction and claims
 *      `idempotency_keys (idempotencyKey, entityType)` first. A retry
 *      that finds a cached JSON response returns it and never debits.
 *      An in-flight NULL response is rejected (409).
 *   3. `SELECT … FOR UPDATE`s the wallet first, then the invoice
 *      (stable lock order vs other wallet mutations).
 *   4. Rejects missing wallets/invoices, other profiles (404), credit
 *      notes, non-PayFromWallet states, not-yet-payable dates, remaining
 *      0, and insufficient derived availableBalance (`posted − reserved`).
 *   5. Debits the exact remaining amount (`type: payment`, `refId` =
 *      invoice id) on the same client so wallet + invoice commit together.
 *      `WalletService.debit` re-locks the wallet and applies the
 *      optimistic `version` predicate as a second line of defense.
 *   6. Sets `paid_amount` to the total and transitions Unpaid /
 *      PartiallyFunded → Paid through the state machine (audit + paid_at)
 *      in the same transaction as the wallet_transactions insert, then
 *      writes the cached JSONB response onto the claimed idempotency row.
 *
 * Retrying with the same idempotency key returns the original Paid result
 * and never debits twice. The unique index
 * `uq_idempotency_keys_key_entity_type` is the last-line duplicate guard.
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { getDbPool } from '@barghsa/db'
import {
  INVOICE_WALLET_PAYMENT_ENTITY_TYPE,
  PAY_INVOICE_WITH_WALLET_DESCRIPTION,
  PAY_INVOICE_WITH_WALLET_ERRORS,
  availableCoversRemaining,
  cachedWalletPaymentMatchesRequest,
  idempotencyKeyExpiresAt,
  isMatchingWalletInvoicePayment,
  parsePayInvoiceWithWalletCache,
  parsePayInvoiceWithWalletIds,
  payInvoiceWithWalletMetadata,
  remainingForWalletPayment,
  serializePayInvoiceWithWalletCache,
  walletAvailableBalance,
  type PayInvoiceWithWalletCachedResponse,
} from '@barghsa/shared/finance'
import { InvoiceAuditRepository } from '../invoice/invoice-audit.repository.js'
import { InvoiceStateMachineService } from '../invoice/invoice-state-machine.service.js'
import {
  isInvoiceState,
  type InvoiceState,
} from '../invoice/invoice-state.model.js'
import {
  WalletService,
  type TransactionRow,
  type WalletQueryClient,
} from './wallet.service.js'

export interface PayInvoiceWithWalletOptions {
  /** Override "now" for tests (payableFrom + paid_at). */
  now?: Date
  /** Source IP of the paying user; omit for system-initiated calls. */
  ip?: string
  /** Opaque correlation ID linking related events. */
  correlationId?: string
  /**
   * Audit actor. Defaults to the profile owner (`profiles.user_id`)
   * because the public signature does not take a user id.
   */
  actorUserId?: string
}

export interface PayInvoiceWithWalletResult {
  invoiceId: string
  profileId: string
  fromState: InvoiceState
  toState: 'Paid'
  remainingPaid: bigint
  walletTransaction: TransactionRow
  auditId: string
  replayed: boolean
}

interface LockedInvoiceRow {
  id: string
  profile_id: string
  state: string
  total_amount: string | number | bigint
  paid_amount: string | number | bigint
  refunded_amount: string | number | bigint
  adjustment_kind: string | null
  payable_from: Date | string | null
}

interface LockedWalletRow {
  profile_id: string
  posted_balance: string | number | bigint
  reserved_balance: string | number | bigint
  version: number
}

@Injectable()
export class PayInvoiceWithWalletService {
  private readonly logger = new Logger(PayInvoiceWithWalletService.name)
  private readonly invoiceStateMachine: InvoiceStateMachineService

  constructor(
    private readonly walletService: WalletService,
    @Optional()
    invoiceStateMachine?: InvoiceStateMachineService,
  ) {
    this.invoiceStateMachine =
      invoiceStateMachine ?? new InvoiceStateMachineService(new InvoiceAuditRepository())
  }

  /**
   * Pay an invoice with a single full wallet debit of the remaining
   * amount. Atomic, idempotent, and gated on availableBalance.
   */
  async payInvoiceWithWallet(
    invoiceId: string,
    profileId: string,
    idempotencyKey: string,
    options: PayInvoiceWithWalletOptions = {},
  ): Promise<PayInvoiceWithWalletResult> {
    const ids = parsePayInvoiceWithWalletIds(invoiceId, profileId)
    if (!ids.ok) {
      throw new BadRequestException(ids.message)
    }
    if (!idempotencyKey.trim()) {
      throw new BadRequestException(PAY_INVOICE_WITH_WALLET_ERRORS.IDEMPOTENCY_REQUIRED())
    }

    const now = options.now ?? new Date()
    const key = idempotencyKey.trim()
    const pool = getDbPool()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const claim = await this.claimOrLoadIdempotency(client, {
        key,
        entityId: ids.invoiceId,
        expiresAt: idempotencyKeyExpiresAt(now),
      })
      if (claim.kind === 'cached') {
        this.assertCachedMatchesRequest(claim.response, ids.invoiceId, ids.profileId)
        await client.query('COMMIT')
        return resultFromCache(claim.response)
      }
      if (claim.kind === 'in_flight') {
        throw new ConflictException(PAY_INVOICE_WITH_WALLET_ERRORS.IDEMPOTENCY_IN_FLIGHT())
      }

      // Wallet first, then invoice: every other money mutation already
      // locks the wallet row, so this order cannot deadlock against them.
      const wallet = await this.lockWallet(client, ids.profileId)
      const invoice = await this.lockInvoice(client, ids.invoiceId)
      if (invoice.profile_id.toLowerCase() !== ids.profileId) {
        throw new NotFoundException(`Invoice not found: ${ids.invoiceId}`)
      }

      const actorUserId = options.actorUserId ?? (await this.profileOwnerUserId(client, invoice.profile_id))
      const totalAmount = BigInt(invoice.total_amount)
      const paidAmount = BigInt(invoice.paid_amount)
      const remaining = remainingForWalletPayment({
        totalAmount,
        paidAmount,
        state: invoice.state,
        adjustmentKind: invoice.adjustment_kind,
      })

      const existing = await this.findLedgerByIdempotencyKey(client, key)
      if (existing) {
        return await this.replayOrReject({
          client,
          invoice,
          existing,
          remaining,
          actorUserId,
          now,
          idempotencyKey: key,
          ...optionalAudit(options),
        })
      }

      this.assertPayable(invoice, remaining, now)
      this.assertAvailableBalance(wallet, remaining)

      const paidAfter = paidAmount + remaining
      const debit = await this.walletService.debit(
        invoice.profile_id,
        remaining,
        {
          type: 'payment',
          refId: invoice.id,
          description: PAY_INVOICE_WITH_WALLET_DESCRIPTION,
          metadata: payInvoiceWithWalletMetadata({
            invoiceId: invoice.id,
            remainingBefore: remaining,
            paidAmountAfter: paidAfter,
          }),
        },
        key,
        client,
      )

      const transition = await this.settleInvoice(client, {
        invoice,
        remaining,
        paidAfter,
        actorUserId,
        now,
        ...optionalAudit(options),
      })

      const result: PayInvoiceWithWalletResult = {
        invoiceId: invoice.id,
        profileId: invoice.profile_id,
        fromState: transition.fromState,
        toState: 'Paid',
        remainingPaid: remaining,
        walletTransaction: debit,
        auditId: transition.auditId,
        replayed: false,
      }
      await this.persistCachedResult(client, key, invoice.id, result)
      await client.query('COMMIT')
      this.logger.log(
        `Invoice ${invoice.id} paid from wallet ${invoice.profile_id} debit=${debit.id} remaining=${remaining.toString()}`,
      )
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  private assertPayable(invoice: LockedInvoiceRow, remaining: bigint, now: Date): void {
    if (invoice.adjustment_kind === 'credit') {
      throw new BadRequestException(
        PAY_INVOICE_WITH_WALLET_ERRORS.CREDIT_NOT_PAYABLE(invoice.id),
      )
    }
    if (!isInvoiceState(invoice.state)) {
      throw new ConflictException(
        PAY_INVOICE_WITH_WALLET_ERRORS.STATE_NOT_PAYABLE(invoice.state),
      )
    }
    if (invoice.state === 'Paid') {
      throw new ConflictException(PAY_INVOICE_WITH_WALLET_ERRORS.ALREADY_PAID())
    }
    if (!this.invoiceStateMachine.canPayFromWallet(invoice.state, invoice.adjustment_kind)) {
      throw new ConflictException(
        PAY_INVOICE_WITH_WALLET_ERRORS.STATE_NOT_PAYABLE(invoice.state),
      )
    }
    if (remaining <= 0n) {
      throw new BadRequestException(PAY_INVOICE_WITH_WALLET_ERRORS.NOTHING_TO_PAY())
    }
    const payableFrom = toDate(invoice.payable_from)
    if (payableFrom && now < payableFrom) {
      throw new BadRequestException(
        PAY_INVOICE_WITH_WALLET_ERRORS.NOT_YET_PAYABLE(payableFrom.toISOString()),
      )
    }
  }

  private assertAvailableBalance(wallet: LockedWalletRow, remaining: bigint): void {
    const available = walletAvailableBalance(
      BigInt(wallet.posted_balance),
      BigInt(wallet.reserved_balance),
    )
    if (!availableCoversRemaining(available, remaining)) {
      throw new BadRequestException(
        PAY_INVOICE_WITH_WALLET_ERRORS.INSUFFICIENT_BALANCE(available, remaining),
      )
    }
  }

  private assertCachedMatchesRequest(
    cached: PayInvoiceWithWalletCachedResponse,
    invoiceId: string,
    profileId: string,
  ): void {
    if (!cachedWalletPaymentMatchesRequest(cached, invoiceId, profileId)) {
      throw new ConflictException(PAY_INVOICE_WITH_WALLET_ERRORS.IDEMPOTENCY_COLLISION())
    }
  }

  private async replayOrReject(input: {
    client: WalletQueryClient
    invoice: LockedInvoiceRow
    existing: TransactionRow
    remaining: bigint
    actorUserId: string
    now: Date
    idempotencyKey: string
    ip?: string
    correlationId?: string
  }): Promise<PayInvoiceWithWalletResult> {
    const matching = isMatchingWalletInvoicePayment({
      walletId: input.existing.walletId,
      expectedWalletId: input.invoice.profile_id,
      invoiceId: input.invoice.id,
      type: input.existing.type,
      state: input.existing.state,
      refId: input.existing.refId,
      amount: input.existing.amount,
    })
    if (!matching) {
      throw new ConflictException(PAY_INVOICE_WITH_WALLET_ERRORS.IDEMPOTENCY_COLLISION())
    }

    const debitAmount = -input.existing.amount
    if (input.invoice.state === 'Paid') {
      const result: PayInvoiceWithWalletResult = {
        invoiceId: input.invoice.id,
        profileId: input.invoice.profile_id,
        fromState: 'Paid',
        toState: 'Paid',
        remainingPaid: debitAmount,
        walletTransaction: input.existing,
        auditId: '',
        replayed: true,
      }
      await this.persistCachedResult(input.client, input.idempotencyKey, input.invoice.id, result)
      await input.client.query('COMMIT')
      return result
    }

    if (input.remaining > 0n && debitAmount !== input.remaining) {
      throw new ConflictException(PAY_INVOICE_WITH_WALLET_ERRORS.IDEMPOTENCY_COLLISION())
    }

    this.assertPayable(input.invoice, input.remaining > 0n ? input.remaining : debitAmount, input.now)

    const paidAfter = BigInt(input.invoice.paid_amount) + debitAmount
    const transition = await this.settleInvoice(input.client, {
      invoice: input.invoice,
      remaining: debitAmount,
      paidAfter,
      actorUserId: input.actorUserId,
      now: input.now,
      ...optionalAudit(input),
    })
    const result: PayInvoiceWithWalletResult = {
      invoiceId: input.invoice.id,
      profileId: input.invoice.profile_id,
      fromState: transition.fromState,
      toState: 'Paid',
      remainingPaid: debitAmount,
      walletTransaction: input.existing,
      auditId: transition.auditId,
      replayed: true,
    }
    await this.persistCachedResult(input.client, input.idempotencyKey, input.invoice.id, result)
    await input.client.query('COMMIT')
    return result
  }

  private async settleInvoice(
    client: WalletQueryClient,
    input: {
      invoice: LockedInvoiceRow
      remaining: bigint
      paidAfter: bigint
      actorUserId: string
      now: Date
      ip?: string
      correlationId?: string
    },
  ) {
    if (!isInvoiceState(input.invoice.state)) {
      throw new ConflictException(
        PAY_INVOICE_WITH_WALLET_ERRORS.STATE_NOT_PAYABLE(input.invoice.state),
      )
    }
    const fromState = input.invoice.state
    const updated = await client.query(
      `UPDATE invoices
          SET paid_amount = paid_amount + $2::bigint,
              updated_at = NOW()
        WHERE id = $1
          AND paid_amount + $2::bigint <= total_amount
        RETURNING paid_amount, total_amount`,
      [input.invoice.id, input.remaining.toString()],
    )
    if (updated.rows.length === 0) {
      throw new ConflictException(PAY_INVOICE_WITH_WALLET_ERRORS.ALREADY_PAID())
    }

    const totalAmount = BigInt(input.invoice.total_amount)
    return this.invoiceStateMachine.transition(input.invoice.id, fromState, 'Paid', {
      actorUserId: input.actorUserId,
      now: input.now,
      financials: {
        paidAmount: input.paidAfter,
        totalAmount,
        refundedAmount: BigInt(input.invoice.refunded_amount),
        incomingPaidAmount: input.paidAfter,
      },
      client,
      ...(input.ip !== undefined ? { ip: input.ip } : {}),
      ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
    })
  }

  private async lockWallet(client: WalletQueryClient, profileId: string): Promise<LockedWalletRow> {
    const result = await client.query(
      `SELECT profile_id, posted_balance, reserved_balance, version,
              (posted_balance - reserved_balance) AS available_balance
         FROM wallets
        WHERE profile_id = $1
        FOR UPDATE`,
      [profileId],
    )
    const row = (result.rows as LockedWalletRow[])[0]
    if (!row) {
      throw new NotFoundException(`Wallet not found: ${profileId}`)
    }
    return row
  }

  private async lockInvoice(client: WalletQueryClient, invoiceId: string): Promise<LockedInvoiceRow> {
    const result = await client.query(
      `SELECT id, profile_id, state, total_amount, paid_amount, refunded_amount,
              adjustment_kind, payable_from
         FROM invoices
        WHERE id = $1
        FOR UPDATE`,
      [invoiceId],
    )
    const row = (result.rows as LockedInvoiceRow[])[0]
    if (!row) {
      throw new NotFoundException(`Invoice not found: ${invoiceId}`)
    }
    return row
  }

  private async profileOwnerUserId(client: WalletQueryClient, profileId: string): Promise<string> {
    const result = await client.query(
      `SELECT user_id FROM profiles WHERE id = $1`,
      [profileId],
    )
    const row = (result.rows as Array<{ user_id: string }>)[0]
    if (!row?.user_id) {
      throw new NotFoundException(`Profile not found: ${profileId}`)
    }
    return row.user_id
  }

  private async findLedgerByIdempotencyKey(
    client: WalletQueryClient,
    idempotencyKey: string,
  ): Promise<TransactionRow | null> {
    const result = await client.query(
      `SELECT * FROM wallet_transactions WHERE idempotency_key = $1`,
      [idempotencyKey],
    )
    const row = result.rows[0]
    if (!row || typeof row !== 'object') return null
    return mapLedger(row as Record<string, unknown>)
  }

  /**
   * Claim `(idempotencyKey, invoice_wallet_payment)` or load the cached
   * response. INSERT … ON CONFLICT DO NOTHING is serialized by the
   * unique index; the loser `SELECT … FOR UPDATE`s the winner's row.
   */
  private async claimOrLoadIdempotency(
    client: WalletQueryClient,
    input: { key: string; entityId: string; expiresAt: Date },
  ): Promise<
    | { kind: 'claimed' }
    | { kind: 'cached'; response: PayInvoiceWithWalletCachedResponse }
    | { kind: 'in_flight' }
  > {
    const inserted = await this.insertIdempotencyClaim(client, input)
    if (inserted) return { kind: 'claimed' }

    const existing = await client.query(
      `SELECT entity_id, response
         FROM idempotency_keys
        WHERE idempotency_key = $1 AND entity_type = $2
        FOR UPDATE`,
      [input.key, INVOICE_WALLET_PAYMENT_ENTITY_TYPE],
    )
    const row = existing.rows[0] as { entity_id: string | null; response: unknown } | undefined
    if (!row) {
      const retried = await this.insertIdempotencyClaim(client, input)
      if (retried) return { kind: 'claimed' }
      throw new ConflictException(PAY_INVOICE_WITH_WALLET_ERRORS.IDEMPOTENCY_IN_FLIGHT())
    }
    if (row.response == null) {
      return { kind: 'in_flight' }
    }
    const parsed = parsePayInvoiceWithWalletCache(row.response)
    if (!parsed) {
      throw new ConflictException(PAY_INVOICE_WITH_WALLET_ERRORS.IDEMPOTENCY_COLLISION())
    }
    return { kind: 'cached', response: parsed }
  }

  private async insertIdempotencyClaim(
    client: WalletQueryClient,
    input: { key: string; entityId: string; expiresAt: Date },
  ): Promise<boolean> {
    const result = await client.query(
      `INSERT INTO idempotency_keys
         (idempotency_key, entity_type, entity_id, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (idempotency_key, entity_type) DO NOTHING
       RETURNING id`,
      [input.key, INVOICE_WALLET_PAYMENT_ENTITY_TYPE, input.entityId, input.expiresAt],
    )
    return result.rows.length > 0
  }

  private async persistCachedResult(
    client: WalletQueryClient,
    idempotencyKey: string,
    entityId: string,
    result: PayInvoiceWithWalletResult,
  ): Promise<void> {
    const snapshot = serializePayInvoiceWithWalletCache(result)
    await client.query(
      `UPDATE idempotency_keys
          SET response = $3::jsonb,
              entity_id = $4,
              updated_at = NOW()
        WHERE idempotency_key = $1 AND entity_type = $2`,
      [
        idempotencyKey,
        INVOICE_WALLET_PAYMENT_ENTITY_TYPE,
        JSON.stringify(snapshot),
        entityId,
      ],
    )
  }
}

function resultFromCache(cached: PayInvoiceWithWalletCachedResponse): PayInvoiceWithWalletResult {
  const tx = cached.walletTransaction
  const fromState: InvoiceState = isInvoiceState(cached.fromState) ? cached.fromState : 'Paid'
  return {
    invoiceId: cached.invoiceId,
    profileId: cached.profileId,
    fromState,
    toState: 'Paid',
    remainingPaid: BigInt(cached.remainingPaid),
    walletTransaction: {
      id: tx.id,
      walletId: tx.walletId,
      type: tx.type,
      amount: BigInt(tx.amount),
      state: tx.state,
      idempotencyKey: tx.idempotencyKey,
      refId: tx.refId,
      description: tx.description,
      metadata: tx.metadata,
      reversesTransactionId: null,
      createdAt: new Date(tx.createdAt),
      updatedAt: new Date(tx.updatedAt),
    },
    auditId: cached.auditId,
    replayed: true,
  }
}

function mapLedger(row: Record<string, unknown>): TransactionRow {
  return {
    id: String(row.id),
    walletId: String(row.wallet_id),
    type: String(row.type),
    amount: BigInt(row.amount as string | number | bigint),
    state: String(row.state),
    idempotencyKey: String(row.idempotency_key),
    refId: row.ref_id == null ? null : String(row.ref_id),
    description: row.description == null ? null : String(row.description),
    metadata: row.metadata ?? null,
    reversesTransactionId:
      row.reverses_transaction_id == null ? null : String(row.reverses_transaction_id),
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  }
}

function optionalAudit(options: { ip?: string; correlationId?: string }): {
  ip?: string
  correlationId?: string
} {
  return {
    ...(options.ip !== undefined ? { ip: options.ip } : {}),
    ...(options.correlationId !== undefined ? { correlationId: options.correlationId } : {}),
  }
}

function toDate(value: Date | string | null): Date | null {
  if (value == null) return null
  if (value instanceof Date) return value
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
