/**
 * Real-PostgreSQL integration tests for WalletService.debit
 * (T-04.2.01.04).
 *
 * Proves against actual PostgreSQL:
 *   1. A debit checks availableBalance, atomically reserves then completes,
 *      inserts a Completed ledger row with a negative amount, and drops
 *      posted_balance while leaving reserved_balance unchanged net of the
 *      reserve/complete pair (version += 2).
 *   2. Retrying with the same idempotency key returns the original
 *      ledger row and does not double-debit.
 *   3. Concurrent debits with distinct keys both post when funds suffice;
 *      the final posted_balance equals the start minus the sum.
 *   4. Concurrent same-key retries debit only once.
 *   5. Insufficient availableBalance (including when reserved funds
 *      consume posted) is rejected and leaves the wallet/ledger unchanged.
 *   6. Concurrent overdraw: exactly one debit succeeds when two amounts
 *      together exceed availableBalance.
 *   7. A missing wallet is NotFound.
 *
 * Wiring: only `getDbPool()` is stubbed, handing the service the
 * schema-scoped Testcontainers pool.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { v7 as uuidv7 } from 'uuid'
import { createIsolatedTestDb, dropTestSchema } from '@barghsa/db/test'
import type { IsolatedTestDb } from '@barghsa/db/test'
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
const WALLET_TX_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0068_create_wallet_transactions.sql',
)

const PROFILE_A = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
const PROFILE_B = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb'
const PROFILE_C = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc'

describe('WalletService.debit — real PostgreSQL (T-04.2.01.04)', () => {
  let ctx: IsolatedTestDb
  let service: WalletService

  beforeAll(async () => {
    ctx = await createIsolatedTestDb('test_', 4)
    poolHolder.pool = ctx.pool
    service = new WalletService()

    await ctx.pool.query(readFileSync(UUIDV7_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
      )
    `)
    await ctx.pool.query(readFileSync(WALLET_TX_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(`INSERT INTO profiles (id) VALUES ($1), ($2), ($3)`, [
      PROFILE_A,
      PROFILE_B,
      PROFILE_C,
    ])
    await ctx.pool.query(`INSERT INTO wallets (profile_id) VALUES ($1), ($2), ($3)`, [
      PROFILE_A,
      PROFILE_B,
      PROFILE_C,
    ])
    await ctx.pool.query(
      `UPDATE wallets
       SET posted_balance = 1_000_000, reserved_balance = 0, version = 0
       WHERE profile_id IN ($1, $2, $3)`,
      [PROFILE_A, PROFILE_B, PROFILE_C],
    )
  }, 60_000)

  afterAll(async () => {
    poolHolder.pool = null
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

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

  async function fetchLedger(profileId: string) {
    const result = await ctx.pool.query<{
      id: string
      type: string
      amount: string
      state: string
      idempotency_key: string
      ref_id: string | null
    }>(
      `SELECT id, type, amount::text AS amount, state, idempotency_key, ref_id
       FROM wallet_transactions
       WHERE wallet_id = $1
       ORDER BY created_at, id`,
      [profileId],
    )
    return result.rows
  }

  it('reserves then completes: negative Completed ledger row, postedBalance drops, reservedBalance nets to original', async () => {
    const before = await fetchWallet(PROFILE_A)
    const tx = await service.debit(
      PROFILE_A,
      250_000n,
      { type: 'payment', refId: 'inv-1', description: 'invoice settlement' },
      'debit-happy-1',
    )

    expect(tx.state).toBe('Completed')
    expect(tx.type).toBe('payment')
    expect(tx.amount).toBe(-250_000n)
    expect(tx.refId).toBe('inv-1')
    expect(tx.idempotencyKey).toBe('debit-happy-1')
    expect(tx.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )

    const after = await fetchWallet(PROFILE_A)
    expect(BigInt(after.posted_balance)).toBe(BigInt(before.posted_balance) - 250_000n)
    expect(BigInt(after.reserved_balance)).toBe(BigInt(before.reserved_balance))
    expect(after.version).toBe(before.version + 2)

    const ledger = await fetchLedger(PROFILE_A)
    expect(ledger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: tx.id,
          type: 'payment',
          amount: '-250000',
          state: 'Completed',
          idempotency_key: 'debit-happy-1',
          ref_id: 'inv-1',
        }),
      ]),
    )
  })

  it('returns the original ledger row on idempotent retry without double-debiting', async () => {
    const first = await service.debit(
      PROFILE_A,
      10_000n,
      { type: 'payment', refId: 'inv-idem' },
      'debit-idem-1',
    )
    const afterFirst = await fetchWallet(PROFILE_A)

    const second = await service.debit(
      PROFILE_A,
      10_000n,
      { type: 'payment', refId: 'inv-idem' },
      'debit-idem-1',
    )
    const afterSecond = await fetchWallet(PROFILE_A)

    expect(second.id).toBe(first.id)
    expect(second.amount).toBe(-10_000n)
    expect(afterSecond.posted_balance).toBe(afterFirst.posted_balance)
    expect(afterSecond.reserved_balance).toBe(afterFirst.reserved_balance)
    expect(afterSecond.version).toBe(afterFirst.version)

    const matching = (await fetchLedger(PROFILE_A)).filter(
      (row) => row.idempotency_key === 'debit-idem-1',
    )
    expect(matching).toHaveLength(1)
  })

  it('retries the same idempotency key with uppercase/lowercase UUID spellings without changing the balance', async () => {
    const first = await service.debit(PROFILE_A, 5_000n, { type: 'payment' }, 'debit-uuid-case')
    const afterFirst = await fetchWallet(PROFILE_A)

    const second = await service.debit(
      PROFILE_A.toUpperCase(),
      5_000n,
      { type: 'payment' },
      'debit-uuid-case',
    )
    const afterSecond = await fetchWallet(PROFILE_A)

    expect(second.id).toBe(first.id)
    expect(second.walletId).toBe(PROFILE_A)
    expect(afterSecond.posted_balance).toBe(afterFirst.posted_balance)
    expect(afterSecond.version).toBe(afterFirst.version)
    expect(
      (await fetchLedger(PROFILE_A)).filter((row) => row.idempotency_key === 'debit-uuid-case'),
    ).toHaveLength(1)
  })

  it('lets concurrent retries of the same idempotency key debit only once', async () => {
    const before = await fetchWallet(PROFILE_A)
    const results = await Promise.all([
      service.debit(PROFILE_A, 4_000n, { type: 'payment' }, 'debit-concurrent-same'),
      service.debit(PROFILE_A, 4_000n, { type: 'payment' }, 'debit-concurrent-same'),
    ])

    expect(results[0]!.id).toBe(results[1]!.id)
    const after = await fetchWallet(PROFILE_A)
    expect(BigInt(after.posted_balance)).toBe(BigInt(before.posted_balance) - 4_000n)
    expect(BigInt(after.reserved_balance)).toBe(BigInt(before.reserved_balance))
    expect(after.version).toBe(before.version + 2)
    expect(
      (await fetchLedger(PROFILE_A)).filter((row) => row.idempotency_key === 'debit-concurrent-same'),
    ).toHaveLength(1)
  })

  it('posts two concurrent debits with distinct keys; postedBalance equals start minus the sum', async () => {
    const before = await fetchWallet(PROFILE_A)
    const results = await Promise.all([
      service.debit(PROFILE_A, 3_000n, { type: 'payment' }, 'debit-concurrent-a'),
      service.debit(PROFILE_A, 7_000n, { type: 'payment' }, 'debit-concurrent-b'),
    ])

    expect(new Set(results.map((r) => r.id)).size).toBe(2)
    expect(results.every((r) => r.amount < 0n)).toBe(true)

    const after = await fetchWallet(PROFILE_A)
    expect(BigInt(after.posted_balance)).toBe(BigInt(before.posted_balance) - 10_000n)
    expect(BigInt(after.reserved_balance)).toBe(BigInt(before.reserved_balance))
    expect(after.version).toBe(before.version + 4)
  })

  it('rejects debit when availableBalance is insufficient and writes no ledger row', async () => {
    await ctx.pool.query(
      `UPDATE wallets SET posted_balance = 50_000, reserved_balance = 0, version = 0 WHERE profile_id = $1`,
      [PROFILE_B],
    )

    await expect(
      service.debit(PROFILE_B, 100_000n, { type: 'payment' }, 'debit-insufficient'),
    ).rejects.toBeInstanceOf(BadRequestException)

    const wallet = await fetchWallet(PROFILE_B)
    expect(wallet.posted_balance).toBe('50000')
    expect(wallet.reserved_balance).toBe('0')
    expect(wallet.version).toBe(0)
    expect(await fetchLedger(PROFILE_B)).toHaveLength(0)
  })

  it('rejects debit when reserved funds leave availableBalance below the amount', async () => {
    await ctx.pool.query(
      `UPDATE wallets SET posted_balance = 200_000, reserved_balance = 150_000, version = 3 WHERE profile_id = $1`,
      [PROFILE_B],
    )

    await expect(
      service.debit(PROFILE_B, 60_000n, { type: 'payment' }, 'debit-reserved-blocks'),
    ).rejects.toBeInstanceOf(BadRequestException)

    const wallet = await fetchWallet(PROFILE_B)
    expect(wallet.posted_balance).toBe('200000')
    expect(wallet.reserved_balance).toBe('150000')
    expect(wallet.version).toBe(3)
    expect(
      (await fetchLedger(PROFILE_B)).filter((row) => row.idempotency_key === 'debit-reserved-blocks'),
    ).toHaveLength(0)
  })

  it('lets exactly one of two concurrent overdrawing debits succeed', async () => {
    await ctx.pool.query(
      `UPDATE wallets SET posted_balance = 100_000, reserved_balance = 0, version = 0 WHERE profile_id = $1`,
      [PROFILE_C],
    )

    const settled = await Promise.allSettled([
      service.debit(PROFILE_C, 80_000n, { type: 'payment' }, 'debit-overdraw-a'),
      service.debit(PROFILE_C, 80_000n, { type: 'payment' }, 'debit-overdraw-b'),
    ])

    const fulfilled = settled.filter((r) => r.status === 'fulfilled')
    const rejected = settled.filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException)

    const after = await fetchWallet(PROFILE_C)
    expect(BigInt(after.posted_balance)).toBe(20_000n)
    expect(BigInt(after.reserved_balance)).toBe(0n)
    expect(after.version).toBe(2)
    expect(await fetchLedger(PROFILE_C)).toHaveLength(1)
  })

  it('throws NotFound for a missing wallet', async () => {
    const missing = uuidv7()
    await expect(
      service.debit(missing, 100n, { type: 'payment' }, 'debit-missing'),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('rejects a non-positive amount before touching the database', async () => {
    await expect(
      service.debit(PROFILE_A, 0n, { type: 'payment' }, 'debit-zero'),
    ).rejects.toBeInstanceOf(BadRequestException)
  })
})
