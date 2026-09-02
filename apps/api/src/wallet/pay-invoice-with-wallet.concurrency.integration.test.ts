/**
 * Real-PostgreSQL integration tests for concurrent `payInvoiceWithWallet`
 * (T-04.2.03.04 / S-04.2.03).
 *
 * Proves against actual PostgreSQL that wallet-to-invoice payment is
 * atomic, idempotent, and race-safe:
 *   1. Concurrent distinct-key attempts on one invoice: exactly one
 *      succeeds; the others fail; the wallet is debited once.
 *   2. Concurrent retries of the same idempotency key return the original
 *      Paid result and never post a second debit.
 *   3. A sequential duplicate key is a replay; the same key on a different
 *      invoice is a collision and does not mutate the second invoice.
 *   4. Insufficient availableBalance (including reserved funds consuming
 *      posted) rolls every write back, including when several callers race.
 *   5. Two invoices racing for funds that cover only one remaining amount:
 *      one settles Paid, the other fails, one ledger row.
 *   6. Two invoices racing when funds cover both remaining amounts: both
 *      settle Paid and postedBalance equals start minus the sum.
 *   7. The same idempotency key racing on two invoices: one settles Paid,
 *      the other is an idempotency collision and stays Unpaid.
 *   8. Distinct-key losers roll back their `idempotency_keys` claims.
 *   9. Concurrent remaining debits of a PartiallyFunded invoice settle once.
 *  10. A concurrent wallet credit (wallet-row lock) and pay-from-wallet
 *      debit complete without deadlock; postedBalance reflects both.
 *  11. Concurrent retries against a live in-flight (NULL) claim all
 *      409 without debiting.
 *  12. Concurrent retries reclaim an expired in-flight claim exactly
 *      once (one Paid original, the rest replay).
 *  13. Three invoices racing for funds that cover two remainings: two
 *      settle Paid, one fails insufficient, two ledger rows.
 *  14. A concurrent wallet reserve and pay-from-wallet debit of the
 *      last available rial: exactly one succeeds, no deadlock.
 *
 * Sequential locking/idempotency coverage lives in
 * `pay-invoice-with-wallet.integration.test.ts` (T-04.2.03.02 / T-04.2.03.03).
 * Wiring: only `getDbPool()` is stubbed, handing the service the
 * schema-scoped Testcontainers pool (max 8 so three concurrent payments
 * each hold a client without starving).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { BadRequestException, ConflictException } from '@nestjs/common'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { v7 as uuidv7 } from 'uuid'
import { createIsolatedTestDb, dropTestSchema } from '@barghsa/db/test'
import type { IsolatedTestDb } from '@barghsa/db/test'
import {
  PAY_INVOICE_WITH_WALLET_ERRORS,
  INVOICE_WALLET_PAYMENT_ENTITY_TYPE,
  WALLET_INVOICE_PAYMENT_EVENT,
} from '@barghsa/shared/finance'
import { InvoiceAuditRepository } from '../invoice/invoice-audit.repository.js'
import { InvoiceStateMachineService } from '../invoice/invoice-state-machine.service.js'
import { PayInvoiceWithWalletService } from './pay-invoice-with-wallet.service.js'
import { WalletService } from './wallet.service.js'
import type { PayInvoiceWithWalletResult } from './pay-invoice-with-wallet.service.js'

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
const IDEMPOTENCY_KEYS_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0073_create_idempotency_keys.sql',
)

const ACTOR_USER_ID = 'actor-pay-wallet-race'
const NOW = new Date('2026-09-02T08:00:00.000Z')
const TOTAL = 1_000_000n

describe('PayInvoiceWithWalletService — concurrent PostgreSQL (T-04.2.03.04)', () => {
  let ctx: IsolatedTestDb
  let service: PayInvoiceWithWalletService
  let walletService: WalletService

  beforeAll(async () => {
    ctx = await createIsolatedTestDb('test_', 8)
    poolHolder.pool = ctx.pool
    walletService = new WalletService()
    service = new PayInvoiceWithWalletService(
      walletService,
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
    await ctx.pool.query(readFileSync(IDEMPOTENCY_KEYS_MIGRATION, 'utf-8').trim())

    await ctx.pool.query(`INSERT INTO users (user_id) VALUES ($1)`, [ACTOR_USER_ID])
  }, 60_000)

  afterAll(async () => {
    poolHolder.pool = null
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  async function seedWallet(input: {
    posted: bigint
    reserved?: bigint
  }): Promise<string> {
    const profileId = uuidv7()
    const reserved = input.reserved ?? 0n
    await ctx.pool.query(`INSERT INTO profiles (id) VALUES ($1)`, [profileId])
    await ctx.pool.query(
      `INSERT INTO wallets (profile_id, posted_balance, reserved_balance, version)
       VALUES ($1, $2::bigint, $3::bigint, 0)`,
      [profileId, input.posted.toString(), reserved.toString()],
    )
    return profileId
  }

  async function seedInvoice(
    profileId: string,
    input: {
      paid?: bigint
      state?: 'Unpaid' | 'PartiallyFunded'
      total?: bigint
    } = {},
  ): Promise<string> {
    const invoiceId = uuidv7()
    const paid = input.paid ?? 0n
    const total = input.total ?? TOTAL
    await ctx.pool.query(
      `INSERT INTO invoices
         (id, profile_id, state, total_amount, paid_amount, refunded_amount, payable_from)
       VALUES ($1, $2, $3, $4::bigint, $5::bigint, 0, $6)`,
      [
        invoiceId,
        profileId,
        input.state ?? 'Unpaid',
        total.toString(),
        paid.toString(),
        new Date('2026-08-01T00:00:00.000Z'),
      ],
    )
    return invoiceId
  }

  async function seedPayable(input: {
    posted: bigint
    reserved?: bigint
    paid?: bigint
    state?: 'Unpaid' | 'PartiallyFunded'
    total?: bigint
  }): Promise<{ profileId: string; invoiceId: string }> {
    const profileId = await seedWallet(input)
    const invoiceId = await seedInvoice(profileId, input)
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

  async function fetchIdempotencyCount(key: string): Promise<number> {
    const result = await ctx.pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM idempotency_keys
        WHERE idempotency_key = $1 AND entity_type = $2`,
      [key, INVOICE_WALLET_PAYMENT_ENTITY_TYPE],
    )
    return Number(result.rows[0]?.n ?? '0')
  }

  async function seedInFlightClaim(
    key: string,
    entityId: string,
    expiresAt: Date,
  ): Promise<void> {
    await ctx.pool.query(
      `INSERT INTO idempotency_keys
         (idempotency_key, entity_type, entity_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [key, INVOICE_WALLET_PAYMENT_ENTITY_TYPE, entityId, expiresAt],
    )
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
      correlationId: 'corr-pay-wallet-race',
    })
  }

  function fulfilledResults(
    settled: PromiseSettledResult<PayInvoiceWithWalletResult>[],
  ): PayInvoiceWithWalletResult[] {
    return settled
      .filter((row): row is PromiseFulfilledResult<PayInvoiceWithWalletResult> => {
        return row.status === 'fulfilled'
      })
      .map((row) => row.value)
  }

  function rejectedReasons(
    settled: PromiseSettledResult<PayInvoiceWithWalletResult>[],
  ): unknown[] {
    return settled
      .filter((row): row is PromiseRejectedResult => row.status === 'rejected')
      .map((row) => row.reason)
  }

  it('lets exactly one of three concurrent distinct-key payments succeed', async () => {
    const { profileId, invoiceId } = await seedPayable({ posted: 1_500_000n })
    const before = await fetchWallet(profileId)
    const keys = [
      `pay-race-a-${invoiceId}`,
      `pay-race-b-${invoiceId}`,
      `pay-race-c-${invoiceId}`,
    ]

    const settled = await Promise.allSettled([
      pay(invoiceId, profileId, keys[0]!),
      pay(invoiceId, profileId, keys[1]!),
      pay(invoiceId, profileId, keys[2]!),
    ])

    const won = fulfilledResults(settled)
    const lost = rejectedReasons(settled)
    expect(won).toHaveLength(1)
    expect(lost).toHaveLength(2)
    expect(won[0]).toMatchObject({
      invoiceId,
      toState: 'Paid',
      remainingPaid: TOTAL,
      replayed: false,
    })
    for (const reason of lost) {
      expect(reason).toBeInstanceOf(ConflictException)
      expect(String((reason as Error).message)).toContain(
        PAY_INVOICE_WITH_WALLET_ERRORS.ALREADY_PAID(),
      )
    }

    const wallet = await fetchWallet(profileId)
    expect(BigInt(wallet.posted_balance)).toBe(BigInt(before.posted_balance) - TOTAL)
    expect(BigInt(wallet.reserved_balance)).toBe(0n)
    expect(wallet.version).toBe(before.version + 2)

    const invoice = await fetchInvoice(invoiceId)
    expect(invoice.state).toBe('Paid')
    expect(BigInt(invoice.paid_amount)).toBe(TOTAL)
    expect(invoice.paid_at).not.toBeNull()

    expect(await fetchLedger(profileId)).toHaveLength(1)
    expect(await fetchAudit(invoiceId)).toEqual([
      expect.objectContaining({ event: WALLET_INVOICE_PAYMENT_EVENT }),
      expect.objectContaining({ event: 'invoice.pay_from_wallet' }),
    ])

    const winnerKey = won[0]!.walletTransaction.idempotencyKey
    expect(keys).toContain(winnerKey)
    expect(await fetchIdempotencyCount(winnerKey)).toBe(1)
    for (const key of keys) {
      if (key !== winnerKey) {
        expect(await fetchIdempotencyCount(key)).toBe(0)
      }
    }
  })

  it('returns the original result for concurrent retries of the same idempotency key', async () => {
    const { profileId, invoiceId } = await seedPayable({ posted: 1_500_000n })
    const before = await fetchWallet(profileId)
    const key = `pay-idem-concurrent-${invoiceId}`

    const settled = await Promise.allSettled([
      pay(invoiceId, profileId, key),
      pay(invoiceId, profileId, key),
      pay(invoiceId, profileId, key),
    ])

    const won = fulfilledResults(settled)
    const lost = rejectedReasons(settled)
    expect(lost).toHaveLength(0)
    expect(won).toHaveLength(3)

    const originals = won.filter((row) => row.replayed === false)
    const replays = won.filter((row) => row.replayed === true)
    expect(originals).toHaveLength(1)
    expect(replays).toHaveLength(2)

    const original = originals[0]!
    const txId = original.walletTransaction.id
    expect(new Set(won.map((row) => row.walletTransaction.id)).size).toBe(1)
    for (const row of won) {
      expect(row).toMatchObject({
        invoiceId,
        toState: 'Paid',
        remainingPaid: TOTAL,
        walletTransaction: expect.objectContaining({ id: txId }),
      })
    }

    const wallet = await fetchWallet(profileId)
    expect(BigInt(wallet.posted_balance)).toBe(BigInt(before.posted_balance) - TOTAL)
    expect(wallet.version).toBe(before.version + 2)
    expect(await fetchLedger(profileId)).toHaveLength(1)
    expect((await fetchInvoice(invoiceId)).state).toBe('Paid')
    expect(await fetchAudit(invoiceId)).toHaveLength(2)
    expect(await fetchIdempotencyCount(key)).toBe(1)
  })

  it('replays a sequential duplicate idempotency key and never debits twice', async () => {
    const { profileId, invoiceId } = await seedPayable({ posted: 1_500_000n })
    const key = `pay-idem-retry-${invoiceId}`

    const first = await pay(invoiceId, profileId, key)
    const afterFirst = await fetchWallet(profileId)
    const second = await pay(invoiceId, profileId, key)

    expect(second.replayed).toBe(true)
    expect(second.walletTransaction.id).toBe(first.walletTransaction.id)
    expect(second.remainingPaid).toBe(first.remainingPaid)
    expect(await fetchWallet(profileId)).toEqual(afterFirst)
    expect(await fetchLedger(profileId)).toHaveLength(1)
    expect((await fetchInvoice(invoiceId)).state).toBe('Paid')
  })

  it('rejects the same key used for a different invoice after a successful payment', async () => {
    const first = await seedPayable({ posted: 1_500_000n })
    const second = await seedPayable({ posted: 1_500_000n })
    const key = `pay-idem-collision-${first.invoiceId}`

    await pay(first.invoiceId, first.profileId, key)
    await expect(pay(second.invoiceId, second.profileId, key)).rejects.toThrow(
      PAY_INVOICE_WITH_WALLET_ERRORS.IDEMPOTENCY_COLLISION(),
    )
    expect((await fetchInvoice(second.invoiceId)).state).toBe('Unpaid')
    expect(await fetchLedger(second.profileId)).toEqual([])
  })

  it('rolls back wallet, invoice, ledger, and audit when availableBalance is insufficient', async () => {
    const { profileId, invoiceId } = await seedPayable({ posted: 100_000n })
    const beforeWallet = await fetchWallet(profileId)

    await expect(pay(invoiceId, profileId, `pay-short-${invoiceId}`)).rejects.toThrow(
      PAY_INVOICE_WITH_WALLET_ERRORS.INSUFFICIENT_BALANCE(100_000n, TOTAL),
    )

    expect(await fetchWallet(profileId)).toEqual(beforeWallet)
    expect((await fetchInvoice(invoiceId)).state).toBe('Unpaid')
    expect(BigInt((await fetchInvoice(invoiceId)).paid_amount)).toBe(0n)
    expect(await fetchLedger(profileId)).toEqual([])
    expect(await fetchAudit(invoiceId)).toEqual([])
  })

  it('rejects concurrent insufficient-balance attempts without writing a ledger row', async () => {
    const { profileId, invoiceId } = await seedPayable({ posted: 100_000n })
    const beforeWallet = await fetchWallet(profileId)

    const settled = await Promise.allSettled([
      pay(invoiceId, profileId, `pay-short-race-a-${invoiceId}`),
      pay(invoiceId, profileId, `pay-short-race-b-${invoiceId}`),
    ])

    expect(fulfilledResults(settled)).toHaveLength(0)
    const lost = rejectedReasons(settled)
    expect(lost).toHaveLength(2)
    for (const reason of lost) {
      expect(reason).toBeInstanceOf(BadRequestException)
      expect(String((reason as Error).message)).toContain(
        PAY_INVOICE_WITH_WALLET_ERRORS.INSUFFICIENT_BALANCE(100_000n, TOTAL),
      )
    }

    expect(await fetchWallet(profileId)).toEqual(beforeWallet)
    expect((await fetchInvoice(invoiceId)).state).toBe('Unpaid')
    expect(await fetchLedger(profileId)).toEqual([])
    expect(await fetchAudit(invoiceId)).toEqual([])
  })

  it('treats reserved funds as unavailable when gating a concurrent remaining debit', async () => {
    const { profileId, invoiceId } = await seedPayable({
      posted: 1_000_000n,
      reserved: 1n,
    })
    const beforeWallet = await fetchWallet(profileId)

    const settled = await Promise.allSettled([
      pay(invoiceId, profileId, `pay-reserved-a-${invoiceId}`),
      pay(invoiceId, profileId, `pay-reserved-b-${invoiceId}`),
    ])

    expect(fulfilledResults(settled)).toHaveLength(0)
    for (const reason of rejectedReasons(settled)) {
      expect(reason).toBeInstanceOf(BadRequestException)
      expect(String((reason as Error).message)).toContain(
        PAY_INVOICE_WITH_WALLET_ERRORS.INSUFFICIENT_BALANCE(999_999n, TOTAL),
      )
    }
    expect(await fetchWallet(profileId)).toEqual(beforeWallet)
    expect((await fetchInvoice(invoiceId)).state).toBe('Unpaid')
    expect(await fetchLedger(profileId)).toEqual([])
  })

  it('lets exactly one of two invoices win when the wallet covers only one remaining amount', async () => {
    const profileId = await seedWallet({ posted: TOTAL })
    const invoiceA = await seedInvoice(profileId)
    const invoiceB = await seedInvoice(profileId)

    const settled = await Promise.allSettled([
      pay(invoiceA, profileId, `pay-overdraw-a-${invoiceA}`),
      pay(invoiceB, profileId, `pay-overdraw-b-${invoiceB}`),
    ])

    const won = fulfilledResults(settled)
    const lost = rejectedReasons(settled)
    expect(won).toHaveLength(1)
    expect(lost).toHaveLength(1)
    expect(won[0]!.toState).toBe('Paid')
    expect(won[0]!.remainingPaid).toBe(TOTAL)
    expect(lost[0]).toBeInstanceOf(BadRequestException)
    expect(String((lost[0] as Error).message)).toContain(
      PAY_INVOICE_WITH_WALLET_ERRORS.INSUFFICIENT_BALANCE(0n, TOTAL),
    )

    const paidA = (await fetchInvoice(invoiceA)).state === 'Paid'
    const paidB = (await fetchInvoice(invoiceB)).state === 'Paid'
    expect(paidA !== paidB).toBe(true)
    expect(BigInt((await fetchWallet(profileId)).posted_balance)).toBe(0n)
    expect(await fetchLedger(profileId)).toHaveLength(1)
    expect(await fetchAudit(won[0]!.invoiceId)).toHaveLength(2)
    expect(await fetchAudit(won[0]!.invoiceId === invoiceA ? invoiceB : invoiceA)).toEqual([])
  })

  it('lets two concurrent invoice payments both succeed when funds cover both remainings', async () => {
    const profileId = await seedWallet({ posted: TOTAL * 2n })
    const invoiceA = await seedInvoice(profileId)
    const invoiceB = await seedInvoice(profileId)
    const before = await fetchWallet(profileId)

    const results = await Promise.all([
      pay(invoiceA, profileId, `pay-both-a-${invoiceA}`),
      pay(invoiceB, profileId, `pay-both-b-${invoiceB}`),
    ])

    expect(new Set(results.map((row) => row.walletTransaction.id)).size).toBe(2)
    expect(results.every((row) => row.toState === 'Paid' && row.replayed === false)).toBe(true)
    expect((await fetchInvoice(invoiceA)).state).toBe('Paid')
    expect((await fetchInvoice(invoiceB)).state).toBe('Paid')
    expect(BigInt((await fetchWallet(profileId)).posted_balance)).toBe(
      BigInt(before.posted_balance) - TOTAL * 2n,
    )
    expect((await fetchWallet(profileId)).version).toBe(before.version + 4)
    expect(await fetchLedger(profileId)).toHaveLength(2)
  })

  it('rejects a concurrent same-key collision on a different invoice', async () => {
    const first = await seedPayable({ posted: 1_500_000n })
    const second = await seedPayable({ posted: 1_500_000n })
    const key = `pay-idem-collision-race-${first.invoiceId}`

    const settled = await Promise.allSettled([
      pay(first.invoiceId, first.profileId, key),
      pay(second.invoiceId, second.profileId, key),
    ])

    const won = fulfilledResults(settled)
    const lost = rejectedReasons(settled)
    expect(won).toHaveLength(1)
    expect(lost).toHaveLength(1)
    expect(won[0]!.replayed).toBe(false)
    expect(won[0]!.toState).toBe('Paid')
    expect(lost[0]).toBeInstanceOf(ConflictException)
    expect(String((lost[0] as Error).message)).toContain(
      PAY_INVOICE_WITH_WALLET_ERRORS.IDEMPOTENCY_COLLISION(),
    )

    const paidFirst = (await fetchInvoice(first.invoiceId)).state === 'Paid'
    const paidSecond = (await fetchInvoice(second.invoiceId)).state === 'Paid'
    expect(paidFirst !== paidSecond).toBe(true)
    const winner = paidFirst ? first : second
    const loser = paidFirst ? second : first
    expect(await fetchLedger(winner.profileId)).toHaveLength(1)
    expect(await fetchLedger(loser.profileId)).toEqual([])
    expect((await fetchInvoice(loser.invoiceId)).state).toBe('Unpaid')
    expect(await fetchIdempotencyCount(key)).toBe(1)
  })

  it('lets exactly one concurrent remaining debit succeed on a PartiallyFunded invoice', async () => {
    const remaining = 400_000n
    const { profileId, invoiceId } = await seedPayable({
      posted: 500_000n,
      paid: 600_000n,
      state: 'PartiallyFunded',
    })
    const before = await fetchWallet(profileId)

    const settled = await Promise.allSettled([
      pay(invoiceId, profileId, `pay-partial-race-a-${invoiceId}`),
      pay(invoiceId, profileId, `pay-partial-race-b-${invoiceId}`),
    ])

    const won = fulfilledResults(settled)
    const lost = rejectedReasons(settled)
    expect(won).toHaveLength(1)
    expect(lost).toHaveLength(1)
    expect(won[0]).toMatchObject({
      fromState: 'PartiallyFunded',
      toState: 'Paid',
      remainingPaid: remaining,
      replayed: false,
    })
    expect(lost[0]).toBeInstanceOf(ConflictException)
    expect(String((lost[0] as Error).message)).toContain(
      PAY_INVOICE_WITH_WALLET_ERRORS.ALREADY_PAID(),
    )

    expect(BigInt((await fetchWallet(profileId)).posted_balance)).toBe(
      BigInt(before.posted_balance) - remaining,
    )
    const invoice = await fetchInvoice(invoiceId)
    expect(invoice.state).toBe('Paid')
    expect(BigInt(invoice.paid_amount)).toBe(TOTAL)
    expect(await fetchLedger(profileId)).toHaveLength(1)
  })

  it('does not deadlock when a wallet credit races a pay-from-wallet debit', async () => {
    const { profileId, invoiceId } = await seedPayable({ posted: 1_500_000n })
    const creditAmount = 100_000n
    const before = await fetchWallet(profileId)

    const [paid, credited] = await Promise.all([
      pay(invoiceId, profileId, `pay-vs-credit-${invoiceId}`),
      walletService.credit(
        profileId,
        creditAmount,
        { type: 'topup' },
        `credit-vs-pay-${invoiceId}`,
      ),
    ])

    expect(paid.toState).toBe('Paid')
    expect(paid.replayed).toBe(false)
    expect(credited.amount).toBe(creditAmount)
    expect(credited.type).toBe('topup')
    expect((await fetchInvoice(invoiceId)).state).toBe('Paid')
    expect(BigInt((await fetchWallet(profileId)).posted_balance)).toBe(
      BigInt(before.posted_balance) - TOTAL + creditAmount,
    )
    expect(await fetchLedger(profileId)).toHaveLength(2)
  })

  it('rejects concurrent retries while an in-flight claim has not persisted', async () => {
    const { profileId, invoiceId } = await seedPayable({ posted: 1_500_000n })
    const before = await fetchWallet(profileId)
    const key = `pay-in-flight-race-${invoiceId}`
    await seedInFlightClaim(key, invoiceId, new Date('2026-09-03T08:00:00.000Z'))

    const settled = await Promise.allSettled([
      pay(invoiceId, profileId, key),
      pay(invoiceId, profileId, key),
      pay(invoiceId, profileId, key),
    ])

    expect(fulfilledResults(settled)).toHaveLength(0)
    const lost = rejectedReasons(settled)
    expect(lost).toHaveLength(3)
    for (const reason of lost) {
      expect(reason).toBeInstanceOf(ConflictException)
      expect(String((reason as Error).message)).toContain(
        PAY_INVOICE_WITH_WALLET_ERRORS.IDEMPOTENCY_IN_FLIGHT(),
      )
    }

    expect(await fetchWallet(profileId)).toEqual(before)
    expect((await fetchInvoice(invoiceId)).state).toBe('Unpaid')
    expect(await fetchLedger(profileId)).toEqual([])
    expect(await fetchAudit(invoiceId)).toEqual([])
    expect(await fetchIdempotencyCount(key)).toBe(1)
  })

  it('lets exactly one concurrent retry reclaim an expired in-flight claim', async () => {
    const { profileId, invoiceId } = await seedPayable({ posted: 1_500_000n })
    const before = await fetchWallet(profileId)
    const key = `pay-expired-reclaim-race-${invoiceId}`
    await seedInFlightClaim(key, invoiceId, new Date('2026-09-01T08:00:00.000Z'))

    const settled = await Promise.allSettled([
      pay(invoiceId, profileId, key),
      pay(invoiceId, profileId, key),
      pay(invoiceId, profileId, key),
    ])

    const won = fulfilledResults(settled)
    const lost = rejectedReasons(settled)
    expect(lost).toHaveLength(0)
    expect(won).toHaveLength(3)

    const originals = won.filter((row) => row.replayed === false)
    const replays = won.filter((row) => row.replayed === true)
    expect(originals).toHaveLength(1)
    expect(replays).toHaveLength(2)
    expect(new Set(won.map((row) => row.walletTransaction.id)).size).toBe(1)

    const wallet = await fetchWallet(profileId)
    expect(BigInt(wallet.posted_balance)).toBe(BigInt(before.posted_balance) - TOTAL)
    expect((await fetchInvoice(invoiceId)).state).toBe('Paid')
    expect(await fetchLedger(profileId)).toHaveLength(1)
    expect(await fetchIdempotencyCount(key)).toBe(1)
  })

  it('lets two of three concurrent invoice payments succeed when funds cover two remainings', async () => {
    const profileId = await seedWallet({ posted: TOTAL * 2n })
    const invoiceA = await seedInvoice(profileId)
    const invoiceB = await seedInvoice(profileId)
    const invoiceC = await seedInvoice(profileId)

    const settled = await Promise.allSettled([
      pay(invoiceA, profileId, `pay-two-of-three-a-${invoiceA}`),
      pay(invoiceB, profileId, `pay-two-of-three-b-${invoiceB}`),
      pay(invoiceC, profileId, `pay-two-of-three-c-${invoiceC}`),
    ])

    const won = fulfilledResults(settled)
    const lost = rejectedReasons(settled)
    expect(won).toHaveLength(2)
    expect(lost).toHaveLength(1)
    expect(won.every((row) => row.toState === 'Paid' && row.replayed === false)).toBe(true)
    expect(lost[0]).toBeInstanceOf(BadRequestException)
    expect(String((lost[0] as Error).message)).toContain(
      PAY_INVOICE_WITH_WALLET_ERRORS.INSUFFICIENT_BALANCE(0n, TOTAL),
    )

    const states = [
      (await fetchInvoice(invoiceA)).state,
      (await fetchInvoice(invoiceB)).state,
      (await fetchInvoice(invoiceC)).state,
    ]
    expect(states.filter((state) => state === 'Paid')).toHaveLength(2)
    expect(states.filter((state) => state === 'Unpaid')).toHaveLength(1)
    expect(BigInt((await fetchWallet(profileId)).posted_balance)).toBe(0n)
    expect(await fetchLedger(profileId)).toHaveLength(2)
  })

  it('lets exactly one of a concurrent reserve and remaining debit succeed', async () => {
    const { profileId, invoiceId } = await seedPayable({ posted: TOTAL })
    const before = await fetchWallet(profileId)

    const [paid, reserved] = await Promise.allSettled([
      pay(invoiceId, profileId, `pay-vs-reserve-${invoiceId}`),
      walletService.reserve(profileId, 1n, `reserve-vs-pay-${invoiceId}`),
    ])
    expect((paid.status === 'fulfilled') !== (reserved.status === 'fulfilled')).toBe(true)

    const wallet = await fetchWallet(profileId)
    const invoice = await fetchInvoice(invoiceId)
    const ledger = await fetchLedger(profileId)
    expect(ledger).toHaveLength(1)

    if (paid.status === 'fulfilled') {
      expect(invoice.state).toBe('Paid')
      expect(BigInt(wallet.posted_balance)).toBe(BigInt(before.posted_balance) - TOTAL)
      expect(BigInt(wallet.reserved_balance)).toBe(0n)
      expect(ledger[0]?.type).toBe('payment')
      expect(reserved.status).toBe('rejected')
      if (reserved.status === 'rejected') {
        expect(reserved.reason).toBeInstanceOf(BadRequestException)
      }
    } else {
      expect(invoice.state).toBe('Unpaid')
      expect(BigInt(wallet.posted_balance)).toBe(BigInt(before.posted_balance))
      expect(BigInt(wallet.reserved_balance)).toBe(1n)
      expect(ledger[0]?.type).toBe('reservation')
      expect(paid.reason).toBeInstanceOf(BadRequestException)
      expect(String(paid.reason)).toContain(
        PAY_INVOICE_WITH_WALLET_ERRORS.INSUFFICIENT_BALANCE(TOTAL - 1n, TOTAL),
      )
    }
  })
})
