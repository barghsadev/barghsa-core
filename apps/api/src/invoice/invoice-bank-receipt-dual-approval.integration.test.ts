/**
 * Real-PostgreSQL integration tests for invoice bank-receipt dual-approval
 * (T-04.3.01.05).
 *
 * Proves against actual PostgreSQL:
 *   1. Amounts below the admin threshold still confirm in one step.
 *   2. Amounts at or above the threshold park in UnderReview and do not
 *      change invoice paid_amount or wallet balance.
 *   3. The same finance staff member cannot complete the parked confirm.
 *   4. A second, different finance staff member settles the receipt.
 *   5. A missing / zero threshold disables the gate.
 *   6. A corrupt stored threshold fails closed.
 *   7. Rejecting a parked receipt cancels the pending approval request
 *      without crediting the wallet.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { v7 as uuidv7 } from 'uuid'
import { createIsolatedTestDb, dropTestSchema } from '@barghsa/db/test'
import type { IsolatedTestDb } from '@barghsa/db/test'
import {
  DUAL_APPROVAL_THRESHOLD_CONFIG_KEY,
  INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ACTION_TYPE,
  INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ERRORS,
  INVOICE_BANK_RECEIPT_DUAL_APPROVAL_REQUESTED_EVENT,
  INVOICE_BANK_RECEIPT_CONFIRMED_EVENT,
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
const APPROVAL_REQUESTS_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0036_create_approval_requests.sql',
)
const OUTBOX_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0025_create_notification_outbox.sql',
)

const PROFILE_A = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
const FIRST_STAFF = 'staff-dual-approval-first'
const SECOND_STAFF = 'staff-dual-approval-second'
const CUSTOMER_USER_ID = 'customer-dual-approval-owner'
const THRESHOLD = 500_000n
const NOW = new Date('2026-09-03T12:00:00.000Z')

function receiptKey(suffix: string): string {
  const pad = suffix.replace(/[^0-9a-f]/gi, 'a').padStart(12, '0').slice(0, 12)
  return `uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-${pad}.pdf`
}

describe('InvoiceBankReceiptConfirmationService dual-approval — real PostgreSQL (T-04.3.01.05)', () => {
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
    await ctx.pool.query(`CREATE TABLE IF NOT EXISTS users (user_id TEXT PRIMARY KEY)`)
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
    await ctx.pool.query(readFileSync(APPROVAL_REQUESTS_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(OUTBOX_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS app_config (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await ctx.pool.query(`INSERT INTO users (user_id) VALUES ($1), ($2), ($3)`, [
      FIRST_STAFF,
      SECOND_STAFF,
      CUSTOMER_USER_ID,
    ])
    await ctx.pool.query(`INSERT INTO profiles (id, user_id) VALUES ($1, $2)`, [
      PROFILE_A,
      CUSTOMER_USER_ID,
    ])
    await ctx.pool.query(`INSERT INTO wallets (profile_id) VALUES ($1)`, [PROFILE_A])
  }, 60_000)

  afterAll(async () => {
    poolHolder.pool = null
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  async function setThreshold(thresholdIrR: number | null, raw?: unknown): Promise<void> {
    await ctx.pool.query(`DELETE FROM app_config WHERE key = $1`, [
      DUAL_APPROVAL_THRESHOLD_CONFIG_KEY,
    ])
    if (raw !== undefined) {
      await ctx.pool.query(`INSERT INTO app_config (key, value) VALUES ($1, $2::jsonb)`, [
        DUAL_APPROVAL_THRESHOLD_CONFIG_KEY,
        JSON.stringify(raw),
      ])
      return
    }
    if (thresholdIrR === null) return
    await ctx.pool.query(`INSERT INTO app_config (key, value) VALUES ($1, $2::jsonb)`, [
      DUAL_APPROVAL_THRESHOLD_CONFIG_KEY,
      JSON.stringify({ threshold_irr: thresholdIrR }),
    ])
  }

  async function insertInvoice(opts: {
    total: bigint
    paid?: bigint
    state?: string
  }): Promise<string> {
    const id = uuidv7()
    await ctx.pool.query(
      `INSERT INTO invoices (id, profile_id, state, total_amount, paid_amount)
       VALUES ($1, $2, $3::invoice_state, $4::bigint, $5::bigint)`,
      [id, PROFILE_A, opts.state ?? 'Unpaid', opts.total.toString(), (opts.paid ?? 0n).toString()],
    )
    return id
  }

  async function insertReceipt(opts: { invoiceId: string; amount: bigint; suffix: string }): Promise<string> {
    const id = uuidv7()
    await ctx.pool.query(
      `INSERT INTO bank_receipts
         (id, invoice_id, profile_id, amount, payment_date, payer_reference, attachment_key, state)
       VALUES ($1, $2, $3, $4::bigint, $5, $6, $7, 'Submitted')`,
      [
        id,
        opts.invoiceId,
        PROFILE_A,
        opts.amount.toString(),
        '2026-08-15',
        `TRK-${opts.suffix}`,
        receiptKey(opts.suffix),
      ],
    )
    return id
  }

  async function invoicePaid(invoiceId: string): Promise<{ paid: bigint; state: string }> {
    const result = await ctx.pool.query<{ paid_amount: string; state: string }>(
      `SELECT paid_amount, state FROM invoices WHERE id = $1`,
      [invoiceId],
    )
    return { paid: BigInt(result.rows[0]!.paid_amount), state: result.rows[0]!.state }
  }

  async function walletPosted(): Promise<bigint> {
    const result = await ctx.pool.query<{ posted_balance: string }>(
      `SELECT posted_balance FROM wallets WHERE profile_id = $1`,
      [PROFILE_A],
    )
    return BigInt(result.rows[0]!.posted_balance)
  }

  async function receiptState(receiptId: string): Promise<string> {
    const result = await ctx.pool.query<{ state: string }>(
      `SELECT state FROM bank_receipts WHERE id = $1`,
      [receiptId],
    )
    return result.rows[0]!.state
  }

  async function pendingApprovals(receiptId: string): Promise<
    Array<{ id: string; initiator_id: string; status: string; amount_irr: string }>
  > {
    const result = await ctx.pool.query<{
      id: string
      initiator_id: string
      status: string
      amount_irr: string
    }>(
      `SELECT id, initiator_id, status, amount_irr::text AS amount_irr
         FROM approval_requests
        WHERE action_type = $1
          AND details->>'receiptId' = $2
        ORDER BY created_at`,
      [INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ACTION_TYPE, receiptId],
    )
    return result.rows
  }

  it('confirms below-threshold receipts in one step', async () => {
    await setThreshold(Number(THRESHOLD))
    const invoiceId = await insertInvoice({ total: 1_000_000n })
    const receiptId = await insertReceipt({
      invoiceId,
      amount: THRESHOLD - 1n,
      suffix: 'below',
    })
    const result = await service.confirm({
      receiptId,
      actorUserId: FIRST_STAFF,
      ip: '10.0.0.9',
      now: NOW,
    })
    expect(result.state).toBe('Confirmed')
    expect(result.dualApprovalPending).toBe(false)
    expect(result.confirmedBy).toBe(FIRST_STAFF)
    expect((await invoicePaid(invoiceId)).paid).toBe(THRESHOLD - 1n)
    expect(await pendingApprovals(receiptId)).toHaveLength(0)
  })

  it('parks at-threshold receipts until a second staff member confirms', async () => {
    await setThreshold(Number(THRESHOLD))
    const invoiceId = await insertInvoice({ total: 2_000_000n })
    const receiptId = await insertReceipt({
      invoiceId,
      amount: THRESHOLD,
      suffix: 'equal',
    })
    const beforeWallet = await walletPosted()

    const first = await service.confirm({
      receiptId,
      actorUserId: FIRST_STAFF,
      ip: '10.0.0.9',
      now: NOW,
    })
    expect(first.state).toBe('UnderReview')
    expect(first.dualApprovalPending).toBe(true)
    expect(first.requiresDualApproval).toBe(true)
    expect(first.dualApprovalInitiatedBy).toBe(FIRST_STAFF)
    expect(first.confirmedBy).toBeNull()
    expect((await invoicePaid(invoiceId)).paid).toBe(0n)
    expect((await invoicePaid(invoiceId)).state).toBe('Unpaid')
    expect(await walletPosted()).toBe(beforeWallet)
    expect(await receiptState(receiptId)).toBe('UnderReview')

    const requests = await pendingApprovals(receiptId)
    expect(requests).toHaveLength(1)
    expect(requests[0]!.status).toBe('pending')
    expect(requests[0]!.initiator_id).toBe(FIRST_STAFF)
    expect(BigInt(requests[0]!.amount_irr)).toBe(THRESHOLD)

    const requestedAudit = await ctx.pool.query<{ event: string }>(
      `SELECT event FROM audit_log
        WHERE event = $1 AND metadata::jsonb ->> 'receiptId' = $2`,
      [INVOICE_BANK_RECEIPT_DUAL_APPROVAL_REQUESTED_EVENT, receiptId],
    )
    expect(requestedAudit.rows).toHaveLength(1)

    const retry = await service.confirm({
      receiptId,
      actorUserId: FIRST_STAFF,
      ip: '10.0.0.9',
      now: NOW,
    })
    expect(retry.state).toBe('UnderReview')
    expect(retry.dualApprovalPending).toBe(true)
    expect((await invoicePaid(invoiceId)).paid).toBe(0n)
    expect(await pendingApprovals(receiptId)).toHaveLength(1)

    const second = await service.confirm({
      receiptId,
      actorUserId: SECOND_STAFF,
      ip: '10.0.0.9',
      now: NOW,
    })
    expect(second.state).toBe('Confirmed')
    expect(second.dualApprovalPending).toBe(false)
    expect(second.confirmedBy).toBe(SECOND_STAFF)
    expect(second.dualApprovalInitiatedBy).toBe(FIRST_STAFF)
    expect((await invoicePaid(invoiceId)).paid).toBe(THRESHOLD)
    expect((await invoicePaid(invoiceId)).state).toBe('PartiallyFunded')
    expect(await receiptState(receiptId)).toBe('Confirmed')

    const after = await pendingApprovals(receiptId)
    expect(after).toHaveLength(1)
    expect(after[0]!.status).toBe('approved')

    const confirmedAudit = await ctx.pool.query<{ event: string }>(
      `SELECT event FROM audit_log
        WHERE event = $1 AND metadata::jsonb ->> 'receiptId' = $2`,
      [INVOICE_BANK_RECEIPT_CONFIRMED_EVENT, receiptId],
    )
    expect(confirmedAudit.rows).toHaveLength(1)
  })

  it('parks amounts above the threshold the same way', async () => {
    await setThreshold(Number(THRESHOLD))
    const invoiceId = await insertInvoice({ total: 2_000_000n })
    const receiptId = await insertReceipt({
      invoiceId,
      amount: THRESHOLD + 1n,
      suffix: 'above',
    })
    const first = await service.confirm({
      receiptId,
      actorUserId: FIRST_STAFF,
      ip: '10.0.0.9',
      now: NOW,
    })
    expect(first.state).toBe('UnderReview')
    expect(first.dualApprovalPending).toBe(true)
    expect((await invoicePaid(invoiceId)).paid).toBe(0n)
  })

  it('disables the gate when no threshold is configured', async () => {
    await setThreshold(null)
    const invoiceId = await insertInvoice({ total: 2_000_000n })
    const receiptId = await insertReceipt({
      invoiceId,
      amount: 1_500_000n,
      suffix: 'disabled-missing',
    })
    const result = await service.confirm({
      receiptId,
      actorUserId: FIRST_STAFF,
      ip: '10.0.0.9',
      now: NOW,
    })
    expect(result.state).toBe('Confirmed')
    expect(result.dualApprovalPending).toBe(false)
    expect(await pendingApprovals(receiptId)).toHaveLength(0)
  })

  it('disables the gate when the threshold is 0', async () => {
    await setThreshold(0)
    const invoiceId = await insertInvoice({ total: 800_000n })
    const receiptId = await insertReceipt({
      invoiceId,
      amount: 800_000n,
      suffix: 'disabled-zero',
    })
    const result = await service.confirm({
      receiptId,
      actorUserId: FIRST_STAFF,
      ip: '10.0.0.9',
      now: NOW,
    })
    expect(result.state).toBe('Confirmed')
    expect((await invoicePaid(invoiceId)).state).toBe('Paid')
  })

  it('fails closed on a corrupt stored threshold', async () => {
    await setThreshold(null, { threshold_irr: -1 })
    const invoiceId = await insertInvoice({ total: 800_000n })
    const receiptId = await insertReceipt({
      invoiceId,
      amount: 800_000n,
      suffix: 'corrupt',
    })
    const rejection = await service
      .confirm({
        receiptId,
        actorUserId: FIRST_STAFF,
        ip: '10.0.0.9',
        now: NOW,
      })
      .catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(HttpException)
    expect((rejection as HttpException).getStatus()).toBe(409)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      message: INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ERRORS.CONFIG_CORRUPT(),
    })
    expect(await receiptState(receiptId)).toBe('Submitted')
    expect((await invoicePaid(invoiceId)).paid).toBe(0n)
    expect(await pendingApprovals(receiptId)).toHaveLength(0)
  })

  it('rejects a parked receipt and cancels the pending approval request', async () => {
    await setThreshold(Number(THRESHOLD))
    const invoiceId = await insertInvoice({ total: 2_000_000n })
    const receiptId = await insertReceipt({
      invoiceId,
      amount: THRESHOLD,
      suffix: 'reject-parked',
    })
    const beforeWallet = await walletPosted()
    await service.confirm({
      receiptId,
      actorUserId: FIRST_STAFF,
      ip: '10.0.0.9',
      now: NOW,
    })
    const rejected = await service.reject({
      receiptId,
      raw: { reason: 'Payer name does not match' },
      actorUserId: SECOND_STAFF,
      ip: '10.0.0.9',
      now: NOW,
    })
    expect(rejected.state).toBe('Rejected')
    expect((await invoicePaid(invoiceId)).paid).toBe(0n)
    expect(await walletPosted()).toBe(beforeWallet)
    const requests = await pendingApprovals(receiptId)
    expect(requests).toHaveLength(1)
    expect(requests[0]!.status).toBe('rejected')
  })
})
