/**
 * Real-PostgreSQL integration tests for staff invoice bank-receipt
 * rejection (T-04.3.01.04).
 *
 * Proves against actual PostgreSQL:
 *   1. Reject marks Submitted / UnderReview receipts Rejected and stores
 *      the trimmed customer-visible reason.
 *   2. Invoice paid_amount and wallet balances are unchanged.
 *   3. A customer notification_outbox row + in-app/email jobs are written
 *      in the same transaction.
 *   4. Same-reason retry is idempotent; a different reason conflicts.
 *   5. Confirm after reject (and reject after confirm) conflict.
 *   6. Audit-insert failure rolls back receipt state and the outbox row.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { v7 as uuidv7 } from 'uuid'
import { createIsolatedTestDb, dropTestSchema } from '@barghsa/db/test'
import type { IsolatedTestDb } from '@barghsa/db/test'
import {
  INVOICE_BANK_RECEIPT_CONFIRM_ERRORS,
  INVOICE_BANK_RECEIPT_REJECTED_EVENT,
  INVOICE_BANK_RECEIPT_REJECTED_NOTIFICATION_EVENT_KEY,
  invoiceBankReceiptRejectedNotificationIdempotencyKey,
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
const OUTBOX_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0025_create_notification_outbox.sql',
)

const PROFILE_A = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
const PROFILE_B = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb'
const CUSTOMER_USER_ID = 'customer-invoice-bank-receipt-owner'
const ACTOR_USER_ID = 'staff-invoice-bank-receipt-reject'
const NOW = new Date('2026-09-03T08:00:00.000Z')

function receiptKey(suffix: string): string {
  const pad = suffix.replace(/[^0-9a-f]/gi, 'a').padStart(12, '0').slice(0, 12)
  return `uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-${pad}.pdf`
}

describe('InvoiceBankReceiptConfirmationService.reject — real PostgreSQL (T-04.3.01.04)', () => {
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
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY
      )
    `)
    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
        user_id TEXT NOT NULL REFERENCES users(user_id)
      )
    `)
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
    await ctx.pool.query(readFileSync(OUTBOX_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(`INSERT INTO users (user_id) VALUES ($1), ($2)`, [
      CUSTOMER_USER_ID,
      ACTOR_USER_ID,
    ])
    await ctx.pool.query(`INSERT INTO profiles (id, user_id) VALUES ($1, $2), ($3, $2)`, [
      PROFILE_A,
      CUSTOMER_USER_ID,
      PROFILE_B,
    ])
    await ctx.pool.query(`INSERT INTO wallets (profile_id) VALUES ($1), ($2)`, [
      PROFILE_A,
      PROFILE_B,
    ])
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
  ): Promise<{ paid: bigint; state: string }> {
    const result = await ctx.pool.query<{ paid_amount: string; state: string }>(
      `SELECT paid_amount, state FROM invoices WHERE id = $1`,
      [invoiceId],
    )
    return {
      paid: BigInt(result.rows[0]!.paid_amount),
      state: result.rows[0]!.state,
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

  it('marks a Submitted receipt Rejected, stores the reason, and notifies the customer', async () => {
    const invoiceId = await insertInvoice({ total: 1_000_000n, paid: 250_000n })
    const receiptId = await insertReceipt({
      invoiceId,
      amount: 400_000n,
      suffix: 'reject-ok',
    })
    const beforeInvoice = await invoiceSettlement(invoiceId)
    const beforeWallet = await walletBalances()

    const result = await service.reject({
      receiptId,
      raw: { reason: '  Illegible scan  ' },
      actorUserId: ACTOR_USER_ID,
      ip: '10.0.0.9',
      now: NOW,
    })

    expect(result.state).toBe('Rejected')
    expect(result.canReject).toBe(false)
    expect(result.canConfirm).toBe(false)
    expect(result.rejectionReason).toBe('Illegible scan')
    expect(result.notificationOutboxId).toBeTruthy()

    const stored = await ctx.pool.query<{ state: string; rejection_reason: string }>(
      `SELECT state, rejection_reason FROM bank_receipts WHERE id = $1`,
      [receiptId],
    )
    expect(stored.rows[0]).toEqual({ state: 'Rejected', rejection_reason: 'Illegible scan' })
    expect(await invoiceSettlement(invoiceId)).toEqual(beforeInvoice)
    expect(await walletBalances()).toEqual(beforeWallet)

    const outbox = await ctx.pool.query<{
      event_key: string
      user_id: string
      channels: string[]
      payload: Record<string, unknown>
      idempotency_key: string
    }>(
      `SELECT event_key, user_id, channels, payload, idempotency_key
         FROM notification_outbox
        WHERE idempotency_key = $1`,
      [invoiceBankReceiptRejectedNotificationIdempotencyKey(receiptId)],
    )
    expect(outbox.rows).toHaveLength(1)
    expect(outbox.rows[0]).toMatchObject({
      event_key: INVOICE_BANK_RECEIPT_REJECTED_NOTIFICATION_EVENT_KEY,
      user_id: CUSTOMER_USER_ID,
      idempotency_key: invoiceBankReceiptRejectedNotificationIdempotencyKey(receiptId),
    })
    expect(outbox.rows[0]!.channels).toEqual(['in_app', 'email'])
    expect(outbox.rows[0]!.payload).toMatchObject({
      receipt_id: receiptId,
      invoice_id: invoiceId,
      amount_irr: '400000',
      reason: 'Illegible scan',
      link_route: `/invoices/${invoiceId}`,
    })

    const jobs = await ctx.pool.query<{ channel: string; priority: string }>(
      `SELECT channel, priority FROM notification_job WHERE outbox_id = $1 ORDER BY channel`,
      [result.notificationOutboxId],
    )
    expect(jobs.rows).toEqual([
      { channel: 'email', priority: 'urgent' },
      { channel: 'in_app', priority: 'urgent' },
    ])

    const audit = await ctx.pool.query<{ event: string }>(
      `SELECT event FROM audit_log
        WHERE event = $1 AND metadata::jsonb ->> 'receiptId' = $2`,
      [INVOICE_BANK_RECEIPT_REJECTED_EVENT, receiptId],
    )
    expect(audit.rows).toHaveLength(1)

    const retry = await service.reject({
      receiptId,
      raw: { reason: 'Illegible scan' },
      actorUserId: ACTOR_USER_ID,
      ip: '10.0.0.9',
      now: NOW,
    })
    expect(retry.state).toBe('Rejected')
    const outboxCount = await ctx.pool.query(
      `SELECT id FROM notification_outbox WHERE idempotency_key = $1`,
      [invoiceBankReceiptRejectedNotificationIdempotencyKey(receiptId)],
    )
    expect(outboxCount.rows).toHaveLength(1)
  })

  it('rejects an UnderReview receipt without touching settlement', async () => {
    const invoiceId = await insertInvoice({ total: 800_000n, paid: 0n })
    const receiptId = await insertReceipt({
      invoiceId,
      amount: 100_000n,
      suffix: 'under-review',
      state: 'UnderReview',
    })
    const result = await service.reject({
      receiptId,
      raw: { reason: 'Payer name mismatch' },
      actorUserId: ACTOR_USER_ID,
      ip: '10.0.0.9',
      now: NOW,
    })
    expect(result.state).toBe('Rejected')
    expect(result.rejectionReason).toBe('Payer name mismatch')
    expect((await invoiceSettlement(invoiceId)).paid).toBe(0n)
    expect((await invoiceSettlement(invoiceId)).state).toBe('Unpaid')
  })

  it('conflicts when re-rejecting with a different reason', async () => {
    const invoiceId = await insertInvoice({ total: 500_000n })
    const receiptId = await insertReceipt({
      invoiceId,
      amount: 50_000n,
      suffix: 'diff-reason',
    })
    await service.reject({
      receiptId,
      raw: { reason: 'Illegible scan' },
      actorUserId: ACTOR_USER_ID,
      ip: '10.0.0.9',
      now: NOW,
    })
    const rejection = await service
      .reject({
        receiptId,
        raw: { reason: 'Wrong amount' },
        actorUserId: ACTOR_USER_ID,
        ip: '10.0.0.9',
        now: NOW,
      })
      .catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(HttpException)
    expect((rejection as HttpException).getStatus()).toBe(409)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      message: INVOICE_BANK_RECEIPT_CONFIRM_ERRORS.ALREADY_REJECTED(),
    })
  })

  it('conflicts when confirming a rejected receipt or rejecting a confirmed one', async () => {
    const invoiceId = await insertInvoice({ total: 400_000n })
    const rejectedId = await insertReceipt({
      invoiceId,
      amount: 40_000n,
      suffix: 'then-confirm',
    })
    await service.reject({
      receiptId: rejectedId,
      raw: { reason: 'Blurry photo' },
      actorUserId: ACTOR_USER_ID,
      ip: '10.0.0.9',
      now: NOW,
    })
    const confirmRejected = await service
      .confirm({
        receiptId: rejectedId,
        actorUserId: ACTOR_USER_ID,
        ip: '10.0.0.9',
        now: NOW,
      })
      .catch((error: unknown) => error)
    expect((confirmRejected as HttpException).getStatus()).toBe(409)

    const confirmedId = await insertReceipt({
      invoiceId,
      amount: 40_000n,
      suffix: 'then-reject',
    })
    await service.confirm({
      receiptId: confirmedId,
      actorUserId: ACTOR_USER_ID,
      ip: '10.0.0.9',
      now: NOW,
    })
    const rejectConfirmed = await service
      .reject({
        receiptId: confirmedId,
        raw: { reason: 'Too late' },
        actorUserId: ACTOR_USER_ID,
        ip: '10.0.0.9',
        now: NOW,
      })
      .catch((error: unknown) => error)
    expect((rejectConfirmed as HttpException).getStatus()).toBe(409)
    expect((rejectConfirmed as HttpException).getResponse()).toMatchObject({
      message: INVOICE_BANK_RECEIPT_CONFIRM_ERRORS.ALREADY_CONFIRMED(),
    })
    const stored = await ctx.pool.query<{ state: string }>(
      `SELECT state FROM bank_receipts WHERE id = $1`,
      [confirmedId],
    )
    expect(stored.rows[0]!.state).toBe('Confirmed')
  })

  it('rolls back receipt state when the rejection audit cannot persist', async () => {
    const invoiceId = await insertInvoice({ total: 300_000n })
    const receiptId = await insertReceipt({
      invoiceId,
      amount: 30_000n,
      suffix: 'audit-fail',
    })
    const before = await invoiceSettlement(invoiceId)

    const failure = await service
      .reject({
        receiptId,
        raw: { reason: 'Illegible scan' },
        actorUserId: 'missing-staff',
        ip: '10.0.0.9',
        now: NOW,
      })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    const stored = await ctx.pool.query<{ state: string; rejection_reason: string | null }>(
      `SELECT state, rejection_reason FROM bank_receipts WHERE id = $1`,
      [receiptId],
    )
    expect(stored.rows[0]).toEqual({ state: 'Submitted', rejection_reason: null })
    expect(await invoiceSettlement(invoiceId)).toEqual(before)
    const outbox = await ctx.pool.query(
      `SELECT id FROM notification_outbox WHERE idempotency_key = $1`,
      [invoiceBankReceiptRejectedNotificationIdempotencyKey(receiptId)],
    )
    expect(outbox.rows).toHaveLength(0)
  })
})
