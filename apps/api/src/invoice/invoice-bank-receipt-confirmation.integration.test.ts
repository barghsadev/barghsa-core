/**
 * Real-PostgreSQL integration tests for staff invoice bank-receipt
 * confirmation (T-04.3.01.03).
 *
 * Proves against actual PostgreSQL:
 *   1. Confirm allocates min(receipt, remaining) onto paid_amount,
 *      transitions invoice state, and marks the receipt Confirmed.
 *   2. Excess over remaining is credited via WalletService.credit() with
 *      a distinct idempotency key; paid_amount never exceeds total.
 *   3. Exact remaining → Paid, no wallet credit.
 *   4. Partial allocation → PartiallyFunded, paid_at unset.
 *   5. Already-Paid invoices take the whole receipt as wallet excess.
 *   6. Closed invoices (Cancelled, Overdue) conflict; receipt stays Submitted.
 *   7. Retrying confirm is idempotent.
 *   8. Audit-insert failure rolls back paid_amount, wallet credit, and
 *      receipt state.
 *   9. Concurrent receipts split remaining without over-settling.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { v7 as uuidv7 } from 'uuid'
import { createIsolatedTestDb, dropTestSchema } from '@barghsa/db/test'
import type { IsolatedTestDb } from '@barghsa/db/test'
import {
  BANK_RECEIPT_OVERPAYMENT_ERRORS,
  INVOICE_BANK_RECEIPT_CONFIRMED_EVENT,
  invoiceBankReceiptOverpaymentCreditIdempotencyKey,
} from '@barghsa/shared/finance'
import { WalletService } from '../wallet/wallet.service.js'
import { InvoiceBankReceiptConfirmationService } from './invoice-bank-receipt-confirmation.service.js'
import { InvoiceStateMachineService } from './invoice-state-machine.service.js'
import { InvoiceAuditRepository } from './invoice-audit.repository.js'

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
const AUDIT_LOG_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0005_create_audit_log.sql',
)
const INVOICES_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0052_add_invoice_amount_check_constraints.sql',
)
const PAID_OVERDUE_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0053_add_invoice_paid_overdue_timestamps.sql',
)
const ADJUSTMENT_KIND_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0067_invoice_adjustment_kind_accounting_amount.sql',
)
const BANK_RECEIPTS_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0078_create_bank_receipts.sql',
)

const PROFILE_A = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
const PROFILE_B = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb'
const ACTOR_USER_ID = 'staff-invoice-bank-receipt-confirm'
const NOW = new Date('2026-09-03T08:00:00.000Z')

function receiptKey(suffix: string): string {
  const pad = suffix.replace(/[^0-9a-f]/gi, 'a').padStart(12, '0').slice(0, 12)
  return `uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-${pad}.pdf`
}

describe('InvoiceBankReceiptConfirmationService — real PostgreSQL (T-04.3.01.03)', () => {
  let ctx: IsolatedTestDb
  let walletService: WalletService
  let service: InvoiceBankReceiptConfirmationService

  beforeAll(async () => {
    ctx = await createIsolatedTestDb('test_', 8)
    poolHolder.pool = ctx.pool
    walletService = new WalletService()
    service = new InvoiceBankReceiptConfirmationService(
      walletService,
      null,
      new InvoiceStateMachineService(new InvoiceAuditRepository()),
    )

    await ctx.pool.query(readFileSync(UUIDV7_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
      )
    `)
    await ctx.pool.query(`CREATE TABLE IF NOT EXISTS users (user_id TEXT PRIMARY KEY)`)
    await ctx.pool.query(readFileSync(WALLET_TX_MIGRATION, 'utf-8').trim())
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
    await ctx.pool.query(readFileSync(PAID_OVERDUE_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(ADJUSTMENT_KIND_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(BANK_RECEIPTS_MIGRATION, 'utf-8').trim())
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

  async function insertReceipt(opts: {
    invoiceId: string
    amount: bigint
    suffix: string
    state?: string
    profileId?: string
  }): Promise<string> {
    const id = uuidv7()
    await ctx.pool.query(
      `INSERT INTO bank_receipts
         (id, invoice_id, profile_id, amount, payment_date, payer_reference, attachment_key, state)
       VALUES ($1, $2, $3, $4::bigint, $5, $6, $7, $8)`,
      [
        id,
        opts.invoiceId,
        opts.profileId ?? PROFILE_A,
        opts.amount.toString(),
        '2026-08-15',
        `TRK-${opts.suffix}`,
        receiptKey(opts.suffix),
        opts.state ?? 'Submitted',
      ],
    )
    return id
  }

  async function invoiceSettlement(
    invoiceId: string,
  ): Promise<{ paid: bigint; state: string; paidAt: Date | null }> {
    const result = await ctx.pool.query<{
      paid_amount: string
      state: string
      paid_at: Date | null
    }>(`SELECT paid_amount, state, paid_at FROM invoices WHERE id = $1`, [invoiceId])
    return {
      paid: BigInt(result.rows[0]!.paid_amount),
      state: result.rows[0]!.state,
      paidAt: result.rows[0]!.paid_at,
    }
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

  async function receiptState(receiptId: string): Promise<string> {
    const result = await ctx.pool.query<{ state: string }>(
      `SELECT state FROM bank_receipts WHERE id = $1`,
      [receiptId],
    )
    return result.rows[0]!.state
  }

  it('credits only the excess to the wallet when the receipt exceeds invoice remaining', async () => {
    const invoiceId = await insertInvoice({ total: 1_000_000n, paid: 600_000n, state: 'Unpaid' })
    const receiptId = await insertReceipt({
      invoiceId,
      amount: 1_200_000n,
      suffix: 'overpay',
    })
    const before = await walletBalances()

    const result = await service.confirm({
      receiptId,
      actorUserId: ACTOR_USER_ID,
      ip: '10.0.0.9',
      now: NOW,
    })

    expect(result.state).toBe('Confirmed')
    expect(result.canConfirm).toBe(false)
    expect(result.confirmedBy).toBe(ACTOR_USER_ID)
    expect(result.overpayment).toMatchObject({
      invoiceId,
      remainingBefore: '400000',
      invoiceAllocation: '400000',
      walletCreditAmount: '800000',
    })
    expect(result.overpayment?.overpaymentCreditTransactionId).toBeTruthy()

    const settled = await invoiceSettlement(invoiceId)
    expect(settled.paid).toBe(1_000_000n)
    expect(settled.state).toBe('Paid')
    expect(settled.paidAt?.toISOString()).toBe(NOW.toISOString())
    const after = await walletBalances()
    expect(after.posted).toBe(before.posted + 800_000n)

    const overpayCredit = await ctx.pool.query<{ amount: string; state: string }>(
      `SELECT amount, state FROM wallet_transactions WHERE idempotency_key = $1`,
      [invoiceBankReceiptOverpaymentCreditIdempotencyKey(receiptId)],
    )
    expect(overpayCredit.rows).toHaveLength(1)
    expect(overpayCredit.rows[0]!.state).toBe('Completed')
    expect(BigInt(overpayCredit.rows[0]!.amount)).toBe(800_000n)

    expect(await receiptState(receiptId)).toBe('Confirmed')

    const second = await service.confirm({
      receiptId,
      actorUserId: ACTOR_USER_ID,
      ip: '10.0.0.9',
      now: NOW,
    })
    expect(second.state).toBe('Confirmed')
    expect(second.overpayment?.overpaymentCreditTransactionId).toBe(
      result.overpayment?.overpaymentCreditTransactionId,
    )
    expect((await invoiceSettlement(invoiceId)).paid).toBe(1_000_000n)
    expect((await walletBalances()).posted).toBe(after.posted)
  })

  it('does not credit the wallet when the receipt equals remaining', async () => {
    const invoiceId = await insertInvoice({ total: 500_000n, paid: 0n })
    const receiptId = await insertReceipt({
      invoiceId,
      amount: 500_000n,
      suffix: 'exact',
    })
    const before = await walletBalances()
    const result = await service.confirm({
      receiptId,
      actorUserId: ACTOR_USER_ID,
      ip: '10.0.0.9',
      now: NOW,
    })
    expect(result.overpayment?.walletCreditAmount).toBe('0')
    expect(result.overpayment?.overpaymentCreditTransactionId).toBeNull()
    const settled = await invoiceSettlement(invoiceId)
    expect(settled.paid).toBe(500_000n)
    expect(settled.state).toBe('Paid')
    expect(settled.paidAt?.toISOString()).toBe(NOW.toISOString())
    expect((await walletBalances()).posted).toBe(before.posted)
    expect(await receiptState(receiptId)).toBe('Confirmed')
  })

  it('marks a partial allocation PartiallyFunded and leaves paid_at unset', async () => {
    const invoiceId = await insertInvoice({ total: 1_000_000n, paid: 0n, state: 'Unpaid' })
    const receiptId = await insertReceipt({
      invoiceId,
      amount: 300_000n,
      suffix: 'partial',
    })
    const before = await walletBalances()
    const result = await service.confirm({
      receiptId,
      actorUserId: ACTOR_USER_ID,
      ip: '10.0.0.9',
      now: NOW,
    })
    expect(result.overpayment?.invoiceAllocation).toBe('300000')
    expect(result.overpayment?.walletCreditAmount).toBe('0')
    const settled = await invoiceSettlement(invoiceId)
    expect(settled.paid).toBe(300_000n)
    expect(settled.state).toBe('PartiallyFunded')
    expect(settled.paidAt).toBeNull()
    expect((await walletBalances()).posted).toBe(before.posted)

    const confirmAudit = await ctx.pool.query<{ event: string }>(
      `SELECT event FROM audit_log
        WHERE event = 'invoice.confirm_bank_receipt'
          AND metadata::jsonb ->> 'invoiceId' = $1`,
      [invoiceId],
    )
    expect(confirmAudit.rows).toHaveLength(1)

    const receiptAudit = await ctx.pool.query<{ event: string }>(
      `SELECT event FROM audit_log
        WHERE event = $1 AND metadata::jsonb ->> 'receiptId' = $2`,
      [INVOICE_BANK_RECEIPT_CONFIRMED_EVENT, receiptId],
    )
    expect(receiptAudit.rows).toHaveLength(1)
  })

  it('credits the full receipt to the wallet when the linked invoice is already Paid', async () => {
    const invoiceId = await insertInvoice({
      total: 500_000n,
      paid: 500_000n,
      state: 'Paid',
    })
    const receiptId = await insertReceipt({
      invoiceId,
      amount: 200_000n,
      suffix: 'paid-excess',
    })
    const before = await walletBalances()
    const result = await service.confirm({
      receiptId,
      actorUserId: ACTOR_USER_ID,
      ip: '10.0.0.9',
      now: NOW,
    })
    expect(result.overpayment).toMatchObject({
      invoiceId,
      remainingBefore: '0',
      invoiceAllocation: '0',
      walletCreditAmount: '200000',
    })
    const settled = await invoiceSettlement(invoiceId)
    expect(settled.paid).toBe(500_000n)
    expect(settled.state).toBe('Paid')
    expect((await walletBalances()).posted).toBe(before.posted + 200_000n)
    const overpayCredit = await ctx.pool.query<{ amount: string }>(
      `SELECT amount FROM wallet_transactions WHERE idempotency_key = $1`,
      [invoiceBankReceiptOverpaymentCreditIdempotencyKey(receiptId)],
    )
    expect(overpayCredit.rows).toHaveLength(1)
    expect(BigInt(overpayCredit.rows[0]!.amount)).toBe(200_000n)
  })

  it('rejects confirmation against a Cancelled invoice', async () => {
    const invoiceId = await insertInvoice({ total: 400_000n, paid: 0n, state: 'Cancelled' })
    const receiptId = await insertReceipt({
      invoiceId,
      amount: 400_000n,
      suffix: 'cancelled-blocked',
    })
    const before = await walletBalances()
    const rejection = await service
      .confirm({
        receiptId,
        actorUserId: ACTOR_USER_ID,
        ip: '10.0.0.9',
        now: NOW,
      })
      .catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(HttpException)
    expect((rejection as HttpException).getStatus()).toBe(409)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      message: BANK_RECEIPT_OVERPAYMENT_ERRORS.INVOICE_STATE_NOT_SETTLEABLE('Cancelled'),
    })
    const settled = await invoiceSettlement(invoiceId)
    expect(settled.paid).toBe(0n)
    expect(settled.state).toBe('Cancelled')
    expect((await walletBalances()).posted).toBe(before.posted)
    expect(await receiptState(receiptId)).toBe('Submitted')
  })

  it('rejects confirmation against an Overdue invoice', async () => {
    const invoiceId = await insertInvoice({ total: 400_000n, paid: 0n, state: 'Overdue' })
    const receiptId = await insertReceipt({
      invoiceId,
      amount: 400_000n,
      suffix: 'overdue-blocked',
    })
    const before = await walletBalances()
    const rejection = await service
      .confirm({
        receiptId,
        actorUserId: ACTOR_USER_ID,
        ip: '10.0.0.9',
        now: NOW,
      })
      .catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(HttpException)
    expect((rejection as HttpException).getStatus()).toBe(409)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      message: BANK_RECEIPT_OVERPAYMENT_ERRORS.INVOICE_STATE_NOT_SETTLEABLE('Overdue'),
    })
    expect(await receiptState(receiptId)).toBe('Submitted')
    expect((await walletBalances()).posted).toBe(before.posted)
  })

  it('rolls back invoice paid_amount, wallet credit, and receipt when confirm audit fails', async () => {
    const invoiceId = await insertInvoice({ total: 1_000_000n, paid: 250_000n })
    const receiptId = await insertReceipt({
      invoiceId,
      amount: 900_000n,
      suffix: 'overpay-audit-fail',
    })
    const beforePaid = (await invoiceSettlement(invoiceId)).paid
    const beforeWallet = await walletBalances()

    const failure = await service
      .confirm({
        receiptId,
        actorUserId: 'missing-staff',
        ip: '10.0.0.9',
        now: NOW,
      })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect((await invoiceSettlement(invoiceId)).paid).toBe(beforePaid)
    expect((await invoiceSettlement(invoiceId)).state).toBe('Unpaid')
    expect((await walletBalances()).posted).toBe(beforeWallet.posted)
    expect(await receiptState(receiptId)).toBe('Submitted')
    const credits = await ctx.pool.query(
      `SELECT id FROM wallet_transactions WHERE idempotency_key = $1`,
      [invoiceBankReceiptOverpaymentCreditIdempotencyKey(receiptId)],
    )
    expect(credits.rows).toHaveLength(0)
  })

  it('splits concurrent overpayments without over-settling the invoice', async () => {
    const invoiceId = await insertInvoice({ total: 500_000n, paid: 0n, state: 'Unpaid' })
    const firstId = await insertReceipt({
      invoiceId,
      amount: 400_000n,
      suffix: 'race-a',
    })
    const secondId = await insertReceipt({
      invoiceId,
      amount: 400_000n,
      suffix: 'race-b',
    })
    const before = await walletBalances()

    const settled = await Promise.allSettled([
      service.confirm({
        receiptId: firstId,
        actorUserId: ACTOR_USER_ID,
        ip: '10.0.0.9',
        now: NOW,
      }),
      service.confirm({
        receiptId: secondId,
        actorUserId: ACTOR_USER_ID,
        ip: '10.0.0.9',
        now: NOW,
      }),
    ])

    const won = settled.filter(
      (row): row is PromiseFulfilledResult<Awaited<ReturnType<typeof service.confirm>>> =>
        row.status === 'fulfilled',
    )
    expect(won).toHaveLength(2)
    expect(settled.every((row) => row.status === 'fulfilled')).toBe(true)

    const invoiceAllocations = won.map((row) => BigInt(row.value.overpayment?.invoiceAllocation ?? '0'))
    const walletCredits = won.map((row) => BigInt(row.value.overpayment?.walletCreditAmount ?? '0'))
    expect(invoiceAllocations.reduce((sum, value) => sum + value, 0n)).toBe(500_000n)
    expect(walletCredits.reduce((sum, value) => sum + value, 0n)).toBe(300_000n)
    expect(walletCredits.some((value) => value > 0n)).toBe(true)

    const settledInvoice = await invoiceSettlement(invoiceId)
    expect(settledInvoice.paid).toBe(500_000n)
    expect(settledInvoice.state).toBe('Paid')
    expect(settledInvoice.paidAt?.toISOString()).toBe(NOW.toISOString())

    const after = await walletBalances()
    expect(after.posted).toBe(before.posted + 300_000n)

    const overpayCredits = await ctx.pool.query<{ amount: string }>(
      `SELECT amount FROM wallet_transactions
        WHERE idempotency_key IN ($1, $2)
        ORDER BY amount DESC`,
      [
        invoiceBankReceiptOverpaymentCreditIdempotencyKey(firstId),
        invoiceBankReceiptOverpaymentCreditIdempotencyKey(secondId),
      ],
    )
    expect(overpayCredits.rows).toHaveLength(1)
    expect(BigInt(overpayCredits.rows[0]!.amount)).toBe(300_000n)

    expect(await receiptState(firstId)).toBe('Confirmed')
    expect(await receiptState(secondId)).toBe('Confirmed')
  })

  it('confirms from UnderReview as well as Submitted', async () => {
    const invoiceId = await insertInvoice({ total: 200_000n, paid: 0n })
    const receiptId = await insertReceipt({
      invoiceId,
      amount: 200_000n,
      suffix: 'under-review',
      state: 'UnderReview',
    })
    const result = await service.confirm({
      receiptId,
      actorUserId: ACTOR_USER_ID,
      ip: '10.0.0.9',
      now: NOW,
    })
    expect(result.state).toBe('Confirmed')
    expect((await invoiceSettlement(invoiceId)).state).toBe('Paid')
  })
})
