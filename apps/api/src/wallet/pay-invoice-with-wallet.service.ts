/**
 * PayInvoiceWithWalletService — settle an invoice with a single full
 * wallet debit (T-04.2.03.01 / T-04.2.03.02 / T-04.2.03.03 / S-04.2.03).
 *
 * `payInvoiceWithWallet(invoiceId, profileId, idempotencyKey)`:
 *   1. Validates UUIDs and a non-blank idempotency key.
 *   2. Opens one DB transaction and claims
 *      `idempotency_keys (idempotencyKey, entityType)` first. A retry
 *      that finds a cached JSON response returns it and never debits.
 *      An in-flight NULL response is rejected (409) unless `expires_at`
 *      has passed, in which case the row is reclaimed.
 *   3. `SELECT … FOR UPDATE OF wallets` then `… OF invoices` (stable
 *      lock order vs other wallet mutations). Available balance is
 *      taken from that locked snapshot (`posted − reserved`).
 *   4. Rejects missing wallets/invoices, other profiles (404), credit
 *      notes, non-PayFromWallet states, not-yet-payable dates, remaining
 *      0, and insufficient locked availableBalance.
 *   5. Debits the exact remaining amount (`type: payment`, `refId` =
 *      invoice id) on the same client so wallet + invoice commit together.
 *      The debit is bound to the locked wallet `version` (optimistic
 *      second line of defense). The returned ledger row must be a
 *      Completed payment of `-remaining` for this invoice; colliding
 *      debit keys are mapped to the wallet payment collision error so
 *      Paid is never written after a partial or unrelated debit.
 *   6. Inserts `wallet.invoice_payment` audit (posted before/after,
 *      remaining, ledger id) then sets `paid_amount` under the locked
 *      invoice `state` predicate and transitions Unpaid / PartiallyFunded
 *      → Paid through the state machine (invoice audit + paid_at) in the
 *      same transaction as the `wallet_transactions` insert, then writes
 *      the cached JSONB response onto the claimed idempotency row.
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
import { v7 as uuidv7 } from 'uuid'
import { getDbPool } from '@barghsa/db'
import {
  INVOICE_WALLET_PAYMENT_ENTITY_TYPE,
  PAY_INVOICE_WITH_WALLET_DESCRIPTION,
  PAY_INVOICE_WITH_WALLET_ERRORS,
  WALLET_INVOICE_PAYMENT_EVENT,
  availableCoversRemaining,
  cachedWalletPaymentMatchesRequest,
  idempotencyKeyExpiresAt,
  isExactRemainingWalletDebit,
  isMatchingWalletInvoicePayment,
  isWalletDebitIdempotencyCollision,
  parsePayInvoiceWithWalletCache,
  parsePayInvoiceWithWalletIds,
  payInvoiceWithWalletAuditMetadata,
  payInvoiceWithWalletMetadata,
  remainingForWalletPayment,
  serializePayInvoiceWithWalletCache,
  walletAvailableBalance,
  type PayInvoiceWithWalletCachedResponse,
} from '@barghsa/shared/finance'
import { IdempotencyKeysRepository } from '../idempotency/idempotency-keys.repository.js'
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
  available_balance: string | number | bigint
  version: number
}

@Injectable()
export class PayInvoiceWithWalletService {
  private readonly logger = new Logger(PayInvoiceWithWalletService.name)
  private readonly invoiceStateMachine: InvoiceStateMachineService
  private readonly idempotencyKeys: IdempotencyKeysRepository

  constructor(
    private readonly walletService: WalletService,
    @Optional()
    invoiceStateMachine?: InvoiceStateMachineService,
    @Optional()
    idempotencyKeys?: IdempotencyKeysRepository,
  ) {
    this.invoiceStateMachine =
      invoiceStateMachine ?? new InvoiceStateMachineService(new InvoiceAuditRepository())
    this.idempotencyKeys = idempotencyKeys ?? new IdempotencyKeysRepository()
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

      const claim = await this.idempotencyKeys.claimOrLoad(client, {
        key,
        entityType: INVOICE_WALLET_PAYMENT_ENTITY_TYPE,
        entityId: ids.invoiceId,
        expiresAt: idempotencyKeyExpiresAt(now),
        now,
      })
      if (claim.kind === 'cached') {
        const parsed = parsePayInvoiceWithWalletCache(claim.response)
        if (!parsed) {
          throw new ConflictException(PAY_INVOICE_WITH_WALLET_ERRORS.IDEMPOTENCY_COLLISION())
        }
        this.assertCachedMatchesRequest(parsed, ids.invoiceId, ids.profileId)
        await client.query('COMMIT')
        return resultFromCache(parsed)
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
      const postedBefore = BigInt(wallet.posted_balance)
      const reserved = BigInt(wallet.reserved_balance)
      const available = this.lockedAvailableBalance(wallet)
      const debit = await this.debitExactRemaining(client, {
        invoice,
        remaining,
        paidAfter,
        idempotencyKey: key,
        expectedVersion: wallet.version,
      })

      await this.recordWalletPaymentAudit(client, {
        invoice,
        debitId: debit.id,
        remaining,
        postedBefore,
        reserved,
        available,
        actorUserId,
        now,
        ...optionalAudit(options),
      })

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

  private lockedAvailableBalance(wallet: LockedWalletRow): bigint {
    const derived = walletAvailableBalance(
      BigInt(wallet.posted_balance),
      BigInt(wallet.reserved_balance),
    )
    const locked = BigInt(wallet.available_balance)
    return locked === derived ? locked : derived
  }

  /**
   * Debit the locked remaining amount on the caller transaction, bound
   * to the `FOR UPDATE` wallet `version`. Rejects colliding idempotency
   * keys and ledger rows that are not an exact remaining payment so the
   * invoice is never marked Paid after a partial or unrelated debit.
   */
  private async debitExactRemaining(
    client: WalletQueryClient,
    input: {
      invoice: LockedInvoiceRow
      remaining: bigint
      paidAfter: bigint
      idempotencyKey: string
      expectedVersion: number
    },
  ): Promise<TransactionRow> {
    let debit: TransactionRow
    try {
      debit = await this.walletService.debit(
        input.invoice.profile_id,
        input.remaining,
        {
          type: 'payment',
          refId: input.invoice.id,
          description: PAY_INVOICE_WITH_WALLET_DESCRIPTION,
          metadata: payInvoiceWithWalletMetadata({
            invoiceId: input.invoice.id,
            remainingBefore: input.remaining,
            paidAmountAfter: input.paidAfter,
          }),
          expectedVersion: input.expectedVersion,
        },
        input.idempotencyKey,
        client,
      )
    } catch (error) {
      if (
        error instanceof ConflictException &&
        isWalletDebitIdempotencyCollision(conflictMessage(error))
      ) {
        throw new ConflictException(PAY_INVOICE_WITH_WALLET_ERRORS.IDEMPOTENCY_COLLISION())
      }
      throw error
    }

    if (
      !isExactRemainingWalletDebit({
        walletId: debit.walletId,
        expectedWalletId: input.invoice.profile_id,
        invoiceId: input.invoice.id,
        type: debit.type,
        state: debit.state,
        refId: debit.refId,
        amount: debit.amount,
        remaining: input.remaining,
      })
    ) {
      throw new ConflictException(PAY_INVOICE_WITH_WALLET_ERRORS.IDEMPOTENCY_COLLISION())
    }
    return debit
  }

  private assertAvailableBalance(wallet: LockedWalletRow, remaining: bigint): void {
    const available = this.lockedAvailableBalance(wallet)
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
          AND state = $3
          AND paid_amount + $2::bigint <= total_amount
        RETURNING paid_amount, total_amount`,
      [input.invoice.id, input.remaining.toString(), fromState],
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

  /**
   * Wallet-side append-only audit for the debit. Must run on the same
   * client as the `wallet_transactions` insert so a later invoice
   * failure rolls this row back with the ledger.
   */
  private async recordWalletPaymentAudit(
    client: WalletQueryClient,
    input: {
      invoice: LockedInvoiceRow
      debitId: string
      remaining: bigint
      postedBefore: bigint
      reserved: bigint
      available: bigint
      actorUserId: string
      now: Date
      ip?: string
      correlationId?: string
    },
  ): Promise<string> {
    const auditId = uuidv7()
    const metadata = payInvoiceWithWalletAuditMetadata({
      invoiceId: input.invoice.id,
      profileId: input.invoice.profile_id,
      walletTransactionId: input.debitId,
      remainingPaid: input.remaining,
      postedBalanceBefore: input.postedBefore,
      postedBalanceAfter: input.postedBefore - input.remaining,
      reservedBalance: input.reserved,
      availableBalance: input.available,
      fromState: input.invoice.state,
    })
    await client.query(
      `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        auditId,
        input.actorUserId,
        WALLET_INVOICE_PAYMENT_EVENT,
        JSON.stringify(metadata),
        input.correlationId ?? null,
        input.ip ?? null,
        input.now,
      ],
    )
    return auditId
  }

  private async lockWallet(client: WalletQueryClient, profileId: string): Promise<LockedWalletRow> {
    const result = await client.query(
      `SELECT profile_id, posted_balance, reserved_balance, version,
              (posted_balance - reserved_balance) AS available_balance
         FROM wallets
        WHERE profile_id = $1
        FOR UPDATE OF wallets`,
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
        FOR UPDATE OF invoices`,
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

  private async persistCachedResult(
    client: WalletQueryClient,
    idempotencyKey: string,
    entityId: string,
    result: PayInvoiceWithWalletResult,
  ): Promise<void> {
    await this.idempotencyKeys.persistResponse(client, {
      key: idempotencyKey,
      entityType: INVOICE_WALLET_PAYMENT_ENTITY_TYPE,
      entityId,
      response: serializePayInvoiceWithWalletCache(result),
    })
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

function conflictMessage(error: ConflictException): string {
  const response = error.getResponse()
  if (typeof response === 'string') return response
  if (typeof response === 'object' && response !== null && 'message' in response) {
    const message = (response as { message: unknown }).message
    if (typeof message === 'string') return message
    if (Array.isArray(message)) return message.map(String).join(' ')
  }
  return error.message
}

function toDate(value: Date | string | null): Date | null {
  if (value == null) return null
  if (value instanceof Date) return value
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
