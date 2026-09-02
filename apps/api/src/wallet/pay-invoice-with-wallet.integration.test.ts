/**
 * Real-PostgreSQL integration tests for PayInvoiceWithWalletService
 * locking (T-04.2.03.02).
 *
 * Proves against actual PostgreSQL that one transaction:
 *   1. `SELECT … FOR UPDATE`s the wallet then the invoice.
 *   2. Validates derived availableBalance (`posted − reserved`).
 *   3. Debits the wallet, marks the invoice Paid, inserts a
 *      wallet_transactions payment row and an invoice audit row together.
 *   4. Rolls every one of those writes back when availableBalance is
 *      insufficient (including when reserved funds consume posted).
 *
 * Concurrent races belong to T-04.2.03.04. Wiring: only `getDbPool()` is
 * stubbed, handing the service the schema-scoped Testcontainers pool.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { NotFoundException } from '@nestjs/common'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { v7 as uuidv7 } from 'uuid'
import { createIsolatedTestDb, dropTestSchema } from '@barghsa/db/test'
import type { IsolatedTestDb } from '@barghsa/db/test'
import { PAY_INVOICE_WITH_WALLET_ERRORS } from '@barghsa/shared/finance'
import { InvoiceAuditRepository } from '../invoice/invoice-audit.repository.js'
import { InvoiceStateMachineService } from '../invoice/invoice-state-machine.service.js'
import { PayInvoiceWithWalletService } from './pay-invoice-with-wallet.service.js'
import { WalletService } from './wallet.service.js'

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
const INVOICES_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0052_add_invoice_amount_check_constraints.sql',
)
const PAID_OVERDUE_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0053_add_invoice_paid_overdue_timestamps.sql',
)
const AUDIT_LOG_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0005_create_audit_log.sql',
)
const ADJUSTMENT_KIND_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0067_invoice_adjustment_kind_accounting_amount.sql',
)
const WALLET_TX_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0068_create_wallet_transactions.sql',
)
const WALLET_AVAILABLE_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0069_wallet_available_balance_check.sql',
)

const ACTOR_USER_ID = 'actor-pay-wallet-lock'
const NOW = new Date('2026-09-02T08:00:00.000Z')
const TOTAL = 1_000_000n

describe('PayInvoiceWithWalletService — real PostgreSQL (T-04.2.03.02)', () => {
  let ctx: IsolatedTestDb
  let service: PayInvoiceWithWalletService

  beforeAll(async () => {
    ctx = await createIsolatedTestDb('test_', 4)
    poolHolder.pool = ctx.pool
    service = new PayInvoiceWithWalletService(
      new WalletService(),
      new InvoiceStateMachineService(new InvoiceAuditRepository()),
    )

    await ctx.pool.query(readFileSync(UUIDV7_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(`CREATE TYPE invoice_state AS ENUM (
      'Draft', 'Unpaid', 'PaymentUnderReview', 'PartiallyFunded', 'Paid',
      'Overdue', 'Cancelled', 'PartiallyRefunded', 'Refunded'
    )`)
    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
      )
    `)
    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
      )
    `)
    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY
      )
    `)

    await ctx.pool.query(readFileSync(INVOICES_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(PAID_OVERDUE_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(AUDIT_LOG_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(ADJUSTMENT_KIND_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(WALLET_TX_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(WALLET_AVAILABLE_MIGRATION, 'utf-8').trim())

    await ctx.pool.query(`INSERT INTO users (user_id) VALUES ($1)`, [ACTOR_USER_ID])
  }, 60_000)

  afterAll(async () => {
    poolHolder.pool = null
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  async function seedPayable(input: {
    posted: bigint
    reserved?: bigint
    paid?: bigint
    state?: 'Unpaid' | 'PartiallyFunded'
  }): Promise<{ profileId: string; invoiceId: string }> {
    const profileId = uuidv7()
    const invoiceId = uuidv7()
    const reserved = input.reserved ?? 0n
    const paid = input.paid ?? 0n
    await ctx.pool.query(`INSERT INTO profiles (id) VALUES ($1)`, [profileId])
    await ctx.pool.query(
      `INSERT INTO wallets (profile_id, posted_balance, reserved_balance, version)
       VALUES ($1, $2::bigint, $3::bigint, 0)`,
      [profileId, input.posted.toString(), reserved.toString()],
    )
    await ctx.pool.query(
      `INSERT INTO invoices
         (id, profile_id, state, total_amount, paid_amount, refunded_amount, payable_from)
       VALUES ($1, $2, $3, $4::bigint, $5::bigint, 0, $6)`,
      [
        invoiceId,
        profileId,
        input.state ?? 'Unpaid',
        TOTAL.toString(),
        paid.toString(),
        new Date('2026-08-01T00:00:00.000Z'),
      ],
    )
    return { profileId, invoiceId }
  }

  async function fetchWallet(profileId: string) {
    const result = await ctx.pool.query<{
      posted_balance: string
      reserved_balance: string
      version: number
    }>(
      `SELECT posted_balance::text AS posted_balance,
              reserved_balance::text AS reserved_balance,
              version
         FROM wallets WHERE profile_id = $1`,
      [profileId],
    )
    return result.rows[0]!
  }

  async function fetchInvoice(invoiceId: string) {
    const result = await ctx.pool.query<{
      state: string
      paid_amount: string
      paid_at: Date | null
    }>(
      `SELECT state, paid_amount::text AS paid_amount, paid_at
         FROM invoices WHERE id = $1`,
      [invoiceId],
    )
    return result.rows[0]!
  }

  async function fetchLedger(profileId: string) {
    const result = await ctx.pool.query<{
      type: string
      amount: string
      state: string
      ref_id: string | null
      idempotency_key: string
    }>(
      `SELECT type, amount::text AS amount, state, ref_id, idempotency_key
         FROM wallet_transactions WHERE wallet_id = $1
         ORDER BY created_at, id`,
      [profileId],
    )
    return result.rows
  }

  async function fetchAudit(invoiceId: string) {
    const result = await ctx.pool.query<{ event: string }>(
      `SELECT event FROM audit_log
        WHERE metadata::jsonb ->> 'invoiceId' = $1
        ORDER BY created_at, id`,
      [invoiceId],
    )
    return result.rows
  }

  function pay(
    invoiceId: string,
    profileId: string,
    idempotencyKey: string,
  ) {
    return service.payInvoiceWithWallet(invoiceId, profileId, idempotencyKey, {
      actorUserId: ACTOR_USER_ID,
      now: NOW,
      ip: '203.0.113.10',
      correlationId: 'corr-pay-wallet-lock',
    })
  }

  it('debits the wallet, marks the invoice Paid, and writes ledger + audit in one commit', async () => {
    const { profileId, invoiceId } = await seedPayable({ posted: 1_500_000n })
    const before = await fetchWallet(profileId)

    const result = await pay(invoiceId, profileId, `pay-lock-happy-${invoiceId}`)

    expect(result).toMatchObject({
      invoiceId,
      profileId,
      fromState: 'Unpaid',
      toState: 'Paid',
      remainingPaid: TOTAL,
      replayed: false,
    })
    expect(result.walletTransaction.amount).toBe(-TOTAL)
    expect(result.walletTransaction.type).toBe('payment')
    expect(result.walletTransaction.state).toBe('Completed')
    expect(result.walletTransaction.refId).toBe(invoiceId)
    expect(result.auditId).toBeTruthy()

    const wallet = await fetchWallet(profileId)
    expect(BigInt(wallet.posted_balance)).toBe(BigInt(before.posted_balance) - TOTAL)
    expect(BigInt(wallet.reserved_balance)).toBe(0n)
    expect(wallet.version).toBe(before.version + 2)

    const invoice = await fetchInvoice(invoiceId)
    expect(invoice.state).toBe('Paid')
    expect(BigInt(invoice.paid_amount)).toBe(TOTAL)
    expect(invoice.paid_at).not.toBeNull()

    expect(await fetchLedger(profileId)).toEqual([
      expect.objectContaining({
        type: 'payment',
        amount: '-1000000',
        state: 'Completed',
        ref_id: invoiceId,
        idempotency_key: `pay-lock-happy-${invoiceId}`,
      }),
    ])
    expect(await fetchAudit(invoiceId)).toEqual([
      expect.objectContaining({ event: 'invoice.pay_from_wallet' }),
    ])
  })

  it('settles a PartiallyFunded remaining amount without touching reserved funds', async () => {
    const { profileId, invoiceId } = await seedPayable({
      posted: 500_000n,
      paid: 600_000n,
      state: 'PartiallyFunded',
    })

    const result = await pay(invoiceId, profileId, `pay-lock-partial-${invoiceId}`)

    expect(result.fromState).toBe('PartiallyFunded')
    expect(result.remainingPaid).toBe(400_000n)
    expect(BigInt((await fetchWallet(profileId)).posted_balance)).toBe(100_000n)
    expect((await fetchInvoice(invoiceId)).state).toBe('Paid')
  })

  it('rolls back wallet, invoice, ledger, and audit when availableBalance is insufficient', async () => {
    const { profileId, invoiceId } = await seedPayable({ posted: 100_000n })
    const beforeWallet = await fetchWallet(profileId)

    await expect(pay(invoiceId, profileId, `pay-lock-short-${invoiceId}`)).rejects.toThrow(
      PAY_INVOICE_WITH_WALLET_ERRORS.INSUFFICIENT_BALANCE(100_000n, TOTAL),
    )

    const wallet = await fetchWallet(profileId)
    expect(wallet).toEqual(beforeWallet)
    expect((await fetchInvoice(invoiceId)).state).toBe('Unpaid')
    expect(BigInt((await fetchInvoice(invoiceId)).paid_amount)).toBe(0n)
    expect(await fetchLedger(profileId)).toEqual([])
    expect(await fetchAudit(invoiceId)).toEqual([])
  })

  it('treats reserved funds as unavailable when gating the remaining debit', async () => {
    const { profileId, invoiceId } = await seedPayable({
      posted: 1_000_000n,
      reserved: 1n,
    })
    const beforeWallet = await fetchWallet(profileId)

    await expect(pay(invoiceId, profileId, `pay-lock-reserved-${invoiceId}`)).rejects.toThrow(
      PAY_INVOICE_WITH_WALLET_ERRORS.INSUFFICIENT_BALANCE(999_999n, TOTAL),
    )

    expect(await fetchWallet(profileId)).toEqual(beforeWallet)
    expect((await fetchInvoice(invoiceId)).state).toBe('Unpaid')
    expect(await fetchLedger(profileId)).toEqual([])
    expect(await fetchAudit(invoiceId)).toEqual([])
  })

  it('returns 404 when the wallet row is missing and leaves the invoice unpaid', async () => {
    const profileId = uuidv7()
    const invoiceId = uuidv7()
    await ctx.pool.query(`INSERT INTO profiles (id) VALUES ($1)`, [profileId])
    await ctx.pool.query(
      `INSERT INTO invoices
         (id, profile_id, state, total_amount, paid_amount, refunded_amount, payable_from)
       VALUES ($1, $2, 'Unpaid', $3::bigint, 0, 0, $4)`,
      [invoiceId, profileId, TOTAL.toString(), new Date('2026-08-01T00:00:00.000Z')],
    )

    await expect(pay(invoiceId, profileId, `pay-lock-nowallet-${invoiceId}`)).rejects.toBeInstanceOf(
      NotFoundException,
    )
    expect((await fetchInvoice(invoiceId)).state).toBe('Unpaid')
    expect(await fetchAudit(invoiceId)).toEqual([])
  })
})
