/**
 * Real-PostgreSQL integration tests for staff bank-receipt confirmation
 * (T-04.2.02.04).
 *
 * Proves against actual PostgreSQL:
 *   1. Confirm calls WalletService.credit(), increments posted_balance,
 *      and releases the Pending intent.
 *   2. Retrying confirm is idempotent (one Completed credit row).
 *   3. Reject stores a customer-visible reason, never credits, and
 *      never changes posted or reserved balance.
 *   4. Confirm after reject (and reject after confirm) is Conflict.
 *   5. Audit insert failure rolls back the pending-state change.
 *   6. Confirm audit-insert failure also rolls back the wallet credit
 *      (posted balance, Completed ledger row, and receipt stay unchanged).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { v7 as uuidv7 } from 'uuid'
import { createIsolatedTestDb, dropTestSchema } from '@barghsa/db/test'
import type { IsolatedTestDb } from '@barghsa/db/test'
import {
  BANK_RECEIPT_CONFIRMED_EVENT,
  BANK_RECEIPT_REJECTED_EVENT,
  BANK_RECEIPT_TOPUP_CHANNEL,
  bankReceiptCreditIdempotencyKey,
  bankReceiptOverpaymentCreditIdempotencyKey,
  bankReceiptTopUpMetadata,
} from '@barghsa/shared/finance'
import { WalletService } from './wallet.service.js'
import { BankReceiptConfirmationService } from './bank-receipt-confirmation.service.js'

const poolHolder = vi.hoisted(() => ({ pool: null as import('pg').Pool | null }))

vi.mock('@barghsa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@barghsa/db')>()
  return {
    ...actual,
    getDbPool: () => {
      if (!poolHolder.pool) {
        throw new Error('test pool not initialized — beforeAll must run first')
      }
      return poolHolder.pool
    },
  }
})

const UUIDV7_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0000_init_uuidv7_function.sql',
)
const WALLET_TX_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0068_create_wallet_transactions.sql',
)
const ATTACHMENT_UNIQUE_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0072_wallet_tx_receipt_attachment_unique.sql',
)
const AUDIT_LOG_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0005_create_audit_log.sql',
)
const INVOICES_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0052_add_invoice_amount_check_constraints.sql',
)

const PROFILE_A = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
const PROFILE_B = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb'
const ACTOR_USER_ID = 'staff-bank-receipt-confirm'
const AMOUNT = 250_000n
const NOW = new Date('2026-09-02T08:00:00.000Z')

function receiptKey(suffix: string): string {
  const pad = suffix.replace(/[^0-9a-f]/gi, 'a').padStart(12, '0').slice(0, 12)
  return `uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-${pad}.pdf`
}

describe('BankReceiptConfirmationService — real PostgreSQL (T-04.2.02.04)', () => {
  let ctx: IsolatedTestDb
  let walletService: WalletService
  let service: BankReceiptConfirmationService

  beforeAll(async () => {
    ctx = await createIsolatedTestDb('test_', 4)
    poolHolder.pool = ctx.pool
    walletService = new WalletService()
    service = new BankReceiptConfirmationService(walletService, null)

    await ctx.pool.query(readFileSync(UUIDV7_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
      )
    `)
    await ctx.pool.query(`CREATE TABLE IF NOT EXISTS users (user_id TEXT PRIMARY KEY)`)
    await ctx.pool.query(readFileSync(WALLET_TX_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(ATTACHMENT_UNIQUE_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(AUDIT_LOG_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(`
      CREATE TYPE invoice_state AS ENUM (
        'Draft', 'Unpaid', 'PaymentUnderReview', 'PartiallyFunded', 'Paid',
        'Overdue', 'Cancelled', 'PartiallyRefunded', 'Refunded'
      )
    `)
    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
      )
    `)
    await ctx.pool.query(readFileSync(INVOICES_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(`INSERT INTO profiles (id) VALUES ($1), ($2)`, [PROFILE_A, PROFILE_B])
    await ctx.pool.query(`INSERT INTO wallets (profile_id) VALUES ($1), ($2)`, [
      PROFILE_A,
      PROFILE_B,
    ])
    await ctx.pool.query(`INSERT INTO users (user_id) VALUES ($1)`, [ACTOR_USER_ID])
  }, 60_000)

  afterAll(async () => {
    poolHolder.pool = null
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  async function insertPending(suffix: string, amount = AMOUNT): Promise<string> {
    const attachment = receiptKey(suffix)
    const result = await ctx.pool.query<{ id: string }>(
      `INSERT INTO wallet_transactions
         (wallet_id, type, amount, state, idempotency_key, description, metadata, receipt_attachment_key)
       VALUES ($1, 'topup', $2::bigint, 'Pending', $3, $4, $5::jsonb, $6)
       RETURNING id`,
      [
        PROFILE_A,
        amount.toString(),
        `idem-bank-receipt-${suffix}`,
        'Bank receipt wallet top-up',
        JSON.stringify(
          bankReceiptTopUpMetadata({
            paymentDate: '2026-08-15',
            payerReference: `TRK-${suffix}`,
            attachmentKey: attachment,
            customerNote: 'Branch transfer',
          }),
        ),
        attachment,
      ],
    )
    return result.rows[0]!.id
  }

  async function insertInvoice(opts: {
    profileId?: string
    total: bigint
    paid?: bigint
    state?: string
  }): Promise<string> {
    const id = uuidv7()
    await ctx.pool.query(
      `INSERT INTO invoices (id, profile_id, state, total_amount, paid_amount)
       VALUES ($1, $2, $3::invoice_state, $4::bigint, $5::bigint)`,
      [
        id,
        opts.profileId ?? PROFILE_A,
        opts.state ?? 'Unpaid',
        opts.total.toString(),
        (opts.paid ?? 0n).toString(),
      ],
    )
    return id
  }

  async function invoicePaid(invoiceId: string): Promise<bigint> {
    const result = await ctx.pool.query<{ paid_amount: string }>(
      `SELECT paid_amount FROM invoices WHERE id = $1`,
      [invoiceId],
    )
    return BigInt(result.rows[0]!.paid_amount)
  }

  async function walletBalances(): Promise<{ posted: bigint; reserved: bigint }> {
    const result = await ctx.pool.query<{
      posted_balance: string
      reserved_balance: string
    }>(`SELECT posted_balance, reserved_balance FROM wallets WHERE profile_id = $1`, [PROFILE_A])
    return {
      posted: BigInt(result.rows[0]!.posted_balance),
      reserved: BigInt(result.rows[0]!.reserved_balance),
    }
  }

  it('credits posted_balance through WalletService.credit() and releases the pending intent', async () => {
    const before = await walletBalances()
    const pendingId = await insertPending('confirm')
    const result = await service.confirm({
      transactionId: pendingId,
      actorUserId: ACTOR_USER_ID,
      ip: '10.0.0.9',
      correlationId: 'corr-confirm',
      now: NOW,
    })

    expect(result.state).toBe('Released')
    expect(result.canDecide).toBe(false)
    expect(result.creditTransactionId).toBeTruthy()
    expect(result.amount).toBe(AMOUNT.toString())

    const after = await walletBalances()
    expect(after.posted).toBe(before.posted + AMOUNT)
    expect(after.reserved).toBe(before.reserved)

    const credit = await ctx.pool.query<{ id: string; state: string; amount: string }>(
      `SELECT id, state, amount FROM wallet_transactions WHERE idempotency_key = $1`,
      [bankReceiptCreditIdempotencyKey(pendingId)],
    )
    expect(credit.rows).toHaveLength(1)
    expect(credit.rows[0]!.state).toBe('Completed')
    expect(BigInt(credit.rows[0]!.amount)).toBe(AMOUNT)
    expect(result.creditTransactionId).toBe(credit.rows[0]!.id)

    const pending = await ctx.pool.query<{ state: string }>(
      `SELECT state FROM wallet_transactions WHERE id = $1`,
      [pendingId],
    )
    expect(pending.rows[0]!.state).toBe('Released')

    const audit = await ctx.pool.query<{ event: string; metadata: string }>(
      `SELECT event, metadata FROM audit_log WHERE event = $1 AND metadata::jsonb ->> 'transactionId' = $2`,
      [BANK_RECEIPT_CONFIRMED_EVENT, pendingId],
    )
    expect(audit.rows).toHaveLength(1)
    expect(JSON.parse(audit.rows[0]!.metadata)).toMatchObject({
      creditTransactionId: credit.rows[0]!.id,
      previousState: 'Pending',
      newState: 'Released',
    })
  })

  it('retries confirm without a second credit', async () => {
    const pendingId = await insertPending('retry')
    const first = await service.confirm({
      transactionId: pendingId,
      actorUserId: ACTOR_USER_ID,
      ip: '10.0.0.9',
      now: NOW,
    })
    const balancesAfterFirst = await walletBalances()
    const second = await service.confirm({
      transactionId: pendingId,
      actorUserId: ACTOR_USER_ID,
      ip: '10.0.0.9',
      now: NOW,
    })
    expect(second.creditTransactionId).toBe(first.creditTransactionId)
    const balancesAfterSecond = await walletBalances()
    expect(balancesAfterSecond.posted).toBe(balancesAfterFirst.posted)

    const credits = await ctx.pool.query(
      `SELECT id FROM wallet_transactions WHERE idempotency_key = $1`,
      [bankReceiptCreditIdempotencyKey(pendingId)],
    )
    expect(credits.rows).toHaveLength(1)
  })

  it('rejects without crediting and records a customer-visible reason', async () => {
    const before = await walletBalances()
    const pendingId = await insertPending('reject')
    const result = await service.reject({
      transactionId: pendingId,
      raw: { reason: 'Payer name does not match the profile' },
      actorUserId: ACTOR_USER_ID,
      ip: '10.0.0.9',
      now: NOW,
    })

    expect(result.state).toBe('Rejected')
    expect(result.staffDecision?.reason).toBe('Payer name does not match the profile')
    expect(result.staffDecision?.customerVisible).toBe(true)
    expect(result.creditTransactionId).toBeNull()

    const after = await walletBalances()
    expect(after.posted).toBe(before.posted)
    expect(after.reserved).toBe(before.reserved)

    const credits = await ctx.pool.query(
      `SELECT id FROM wallet_transactions WHERE idempotency_key = $1`,
      [bankReceiptCreditIdempotencyKey(pendingId)],
    )
    expect(credits.rows).toHaveLength(0)

    const audit = await ctx.pool.query<{ metadata: string }>(
      `SELECT metadata FROM audit_log WHERE event = $1 AND metadata::jsonb ->> 'transactionId' = $2`,
      [BANK_RECEIPT_REJECTED_EVENT, pendingId],
    )
    expect(audit.rows).toHaveLength(1)
    expect(JSON.parse(audit.rows[0]!.metadata)).toMatchObject({
      reason: 'Payer name does not match the profile',
      customerVisible: true,
      newState: 'Rejected',
    })
  })

  it('refuses confirm after reject and reject after confirm', async () => {
    const rejectedId = await insertPending('no-confirm')
    await service.reject({
      transactionId: rejectedId,
      raw: { reason: 'Duplicate slip' },
      actorUserId: ACTOR_USER_ID,
      ip: '10.0.0.9',
      now: NOW,
    })
    const confirmAfterReject = await service
      .confirm({
        transactionId: rejectedId,
        actorUserId: ACTOR_USER_ID,
        ip: '10.0.0.9',
        now: NOW,
      })
      .catch((error: unknown) => error)
    expect(confirmAfterReject).toBeInstanceOf(HttpException)
    expect((confirmAfterReject as HttpException).getStatus()).toBe(409)

    const confirmedId = await insertPending('no-reject')
    await service.confirm({
      transactionId: confirmedId,
      actorUserId: ACTOR_USER_ID,
      ip: '10.0.0.9',
      now: NOW,
    })
    const rejectAfterConfirm = await service
      .reject({
        transactionId: confirmedId,
        raw: { reason: 'Changed my mind' },
        actorUserId: ACTOR_USER_ID,
        ip: '10.0.0.9',
        now: NOW,
      })
      .catch((error: unknown) => error)
    expect(rejectAfterConfirm).toBeInstanceOf(HttpException)
    expect((rejectAfterConfirm as HttpException).getStatus()).toBe(409)
  })

  it('rolls back the pending-state change when the audit insert fails', async () => {
    const pendingId = await insertPending('audit-fail')
    const before = await walletBalances()
    const rejection = await service
      .reject({
        transactionId: pendingId,
        raw: { reason: 'Missing stamp' },
        actorUserId: 'missing-staff',
        ip: '10.0.0.9',
        now: NOW,
      })
      .catch((error: unknown) => error)

    expect(rejection).toBeInstanceOf(Error)
    const pending = await ctx.pool.query<{ state: string }>(
      `SELECT state FROM wallet_transactions WHERE id = $1`,
      [pendingId],
    )
    expect(pending.rows[0]!.state).toBe('Pending')
    const after = await walletBalances()
    expect(after.posted).toBe(before.posted)
  })

  it('rolls back credit, balance, and receipt when confirm audit insert fails', async () => {
    const pendingId = await insertPending('confirm-audit-fail')
    const before = await walletBalances()
    const failure = await service
      .confirm({
        transactionId: pendingId,
        actorUserId: 'missing-staff',
        ip: '10.0.0.9',
        now: NOW,
      })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)

    const pending = await ctx.pool.query<{ state: string }>(
      `SELECT state FROM wallet_transactions WHERE id = $1`,
      [pendingId],
    )
    expect(pending.rows[0]!.state).toBe('Pending')

    const credits = await ctx.pool.query(
      `SELECT id FROM wallet_transactions WHERE idempotency_key = $1`,
      [bankReceiptCreditIdempotencyKey(pendingId)],
    )
    expect(credits.rows).toHaveLength(0)

    const after = await walletBalances()
    expect(after.posted).toBe(before.posted)
    expect(after.reserved).toBe(before.reserved)

    const audit = await ctx.pool.query(
      `SELECT id FROM audit_log WHERE event = $1 AND metadata::jsonb ->> 'transactionId' = $2`,
      [BANK_RECEIPT_CONFIRMED_EVENT, pendingId],
    )
    expect(audit.rows).toHaveLength(0)
  })

  it('credits only the excess to the wallet when the receipt exceeds invoice remaining', async () => {
    const invoiceId = await insertInvoice({ total: 1_000_000n, paid: 600_000n, state: 'Unpaid' })
    const pendingId = await insertPending('overpay', 1_200_000n)
    const before = await walletBalances()

    const result = await service.confirm({
      transactionId: pendingId,
      actorUserId: ACTOR_USER_ID,
      ip: '10.0.0.9',
      invoiceId,
      now: NOW,
    })

    expect(result.state).toBe('Released')
    expect(result.overpayment).toMatchObject({
      invoiceId,
      remainingBefore: '400000',
      invoiceAllocation: '400000',
      walletCreditAmount: '800000',
    })
    expect(result.creditTransactionId).toBe(result.overpayment?.overpaymentCreditTransactionId)

    expect(await invoicePaid(invoiceId)).toBe(1_000_000n)
    const after = await walletBalances()
    expect(after.posted).toBe(before.posted + 800_000n)

    const topUpCredit = await ctx.pool.query(
      `SELECT id FROM wallet_transactions WHERE idempotency_key = $1`,
      [bankReceiptCreditIdempotencyKey(pendingId)],
    )
    expect(topUpCredit.rows).toHaveLength(0)

    const overpayCredit = await ctx.pool.query<{ amount: string; state: string }>(
      `SELECT amount, state FROM wallet_transactions WHERE idempotency_key = $1`,
      [bankReceiptOverpaymentCreditIdempotencyKey(pendingId)],
    )
    expect(overpayCredit.rows).toHaveLength(1)
    expect(overpayCredit.rows[0]!.state).toBe('Completed')
    expect(BigInt(overpayCredit.rows[0]!.amount)).toBe(800_000n)

    const second = await service.confirm({
      transactionId: pendingId,
      actorUserId: ACTOR_USER_ID,
      ip: '10.0.0.9',
      invoiceId,
      now: NOW,
    })
    expect(second.creditTransactionId).toBe(result.creditTransactionId)
    expect(await invoicePaid(invoiceId)).toBe(1_000_000n)
    expect((await walletBalances()).posted).toBe(after.posted)
  })

  it('does not credit the wallet when the receipt equals remaining', async () => {
    const invoiceId = await insertInvoice({ total: 500_000n, paid: 0n })
    const pendingId = await insertPending('exact', 500_000n)
    const before = await walletBalances()
    const result = await service.confirm({
      transactionId: pendingId,
      actorUserId: ACTOR_USER_ID,
      ip: '10.0.0.9',
      invoiceId,
      now: NOW,
    })
    expect(result.overpayment?.walletCreditAmount).toBe('0')
    expect(result.overpayment?.overpaymentCreditTransactionId).toBeNull()
    expect(await invoicePaid(invoiceId)).toBe(500_000n)
    expect((await walletBalances()).posted).toBe(before.posted)
  })

  it('rolls back invoice paid_amount when overpayment confirm audit fails', async () => {
    const invoiceId = await insertInvoice({ total: 1_000_000n, paid: 250_000n })
    const pendingId = await insertPending('overpay-audit-fail', 900_000n)
    const beforePaid = await invoicePaid(invoiceId)
    const beforeWallet = await walletBalances()

    const failure = await service
      .confirm({
        transactionId: pendingId,
        actorUserId: 'missing-staff',
        ip: '10.0.0.9',
        invoiceId,
        now: NOW,
      })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect(await invoicePaid(invoiceId)).toBe(beforePaid)
    expect((await walletBalances()).posted).toBe(beforeWallet.posted)
    const pending = await ctx.pool.query<{ state: string }>(
      `SELECT state FROM wallet_transactions WHERE id = $1`,
      [pendingId],
    )
    expect(pending.rows[0]!.state).toBe('Pending')
  })
})
