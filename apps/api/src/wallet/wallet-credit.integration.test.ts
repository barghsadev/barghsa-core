/**
 * Real-PostgreSQL integration tests for WalletService.credit
 * (T-04.2.01.03).
 *
 * Proves against actual PostgreSQL:
 *   1. A credit inserts a Completed ledger row and increments
 *      posted_balance + version under
 *      `WHERE version = X AND posted_balance >= 0`.
 *   2. Retrying with the same idempotency key returns the original
 *      ledger row and does not double-credit.
 *   3. Concurrent credits with distinct keys both post; the final
 *      posted_balance equals the sum.
 *   4. A wallet whose posted_balance is already negative is rejected
 *      and left unchanged (no ledger row).
 *   5. A missing wallet is NotFound.
 *
 * Wiring: only `getDbPool()` is stubbed, handing the service the
 * schema-scoped Testcontainers pool.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
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

describe('WalletService.credit — real PostgreSQL (T-04.2.01.03)', () => {
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
    await ctx.pool.query(`INSERT INTO profiles (id) VALUES ($1), ($2)`, [PROFILE_A, PROFILE_B])
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

  it('inserts a ledger row and increments postedBalance + version', async () => {
    const before = await fetchWallet(PROFILE_A)
    const tx = await service.credit(
      PROFILE_A,
      250_000n,
      { type: 'topup', refId: 'provider-evt-1', description: 'online top-up' },
      'credit-happy-1',
    )

    expect(tx.state).toBe('Completed')
    expect(tx.type).toBe('topup')
    expect(tx.amount).toBe(250_000n)
    expect(tx.refId).toBe('provider-evt-1')
    expect(tx.idempotencyKey).toBe('credit-happy-1')
    expect(tx.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )

    const after = await fetchWallet(PROFILE_A)
    expect(BigInt(after.posted_balance)).toBe(BigInt(before.posted_balance) + 250_000n)
    expect(after.version).toBe(before.version + 1)

    const ledger = await fetchLedger(PROFILE_A)
    expect(ledger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: tx.id,
          type: 'topup',
          amount: '250000',
          state: 'Completed',
          idempotency_key: 'credit-happy-1',
          ref_id: 'provider-evt-1',
        }),
      ]),
    )
  })

  it('returns the original ledger row on idempotent retry without double-crediting', async () => {
    const first = await service.credit(
      PROFILE_A,
      10_000n,
      { type: 'refund', refId: 'refund-1' },
      'credit-idem-1',
    )
    const afterFirst = await fetchWallet(PROFILE_A)

    const second = await service.credit(
      PROFILE_A,
      10_000n,
      { type: 'refund', refId: 'refund-1' },
      'credit-idem-1',
    )
    const afterSecond = await fetchWallet(PROFILE_A)

    expect(second.id).toBe(first.id)
    expect(afterSecond.posted_balance).toBe(afterFirst.posted_balance)
    expect(afterSecond.version).toBe(afterFirst.version)

    const matching = (await fetchLedger(PROFILE_A)).filter(
      (row) => row.idempotency_key === 'credit-idem-1',
    )
    expect(matching).toHaveLength(1)
  })

  it('lets concurrent retries of the same idempotency key credit only once', async () => {
    const before = await fetchWallet(PROFILE_A)
    const results = await Promise.all([
      service.credit(PROFILE_A, 4_000n, { type: 'topup' }, 'credit-concurrent-same'),
      service.credit(PROFILE_A, 4_000n, { type: 'topup' }, 'credit-concurrent-same'),
    ])

    expect(results[0]!.id).toBe(results[1]!.id)
    const after = await fetchWallet(PROFILE_A)
    expect(BigInt(after.posted_balance)).toBe(BigInt(before.posted_balance) + 4_000n)
    expect(after.version).toBe(before.version + 1)
    expect(
      (await fetchLedger(PROFILE_A)).filter((row) => row.idempotency_key === 'credit-concurrent-same'),
    ).toHaveLength(1)
  })

  it('posts two concurrent credits with distinct keys; postedBalance equals the sum', async () => {
    const before = await fetchWallet(PROFILE_A)
    const results = await Promise.all([
      service.credit(PROFILE_A, 3_000n, { type: 'topup' }, 'credit-concurrent-a'),
      service.credit(PROFILE_A, 7_000n, { type: 'topup' }, 'credit-concurrent-b'),
    ])

    expect(new Set(results.map((r) => r.id)).size).toBe(2)

    const after = await fetchWallet(PROFILE_A)
    expect(BigInt(after.posted_balance)).toBe(BigInt(before.posted_balance) + 10_000n)
    expect(after.version).toBe(before.version + 2)
  })

  it('rejects credit when postedBalance is already negative and writes no ledger row', async () => {
    await ctx.pool.query(`UPDATE wallets SET posted_balance = -1, version = 0 WHERE profile_id = $1`, [
      PROFILE_B,
    ])

    await expect(
      service.credit(PROFILE_B, 100n, { type: 'topup' }, 'credit-negative-posted'),
    ).rejects.toBeInstanceOf(ConflictException)

    const wallet = await fetchWallet(PROFILE_B)
    expect(wallet.posted_balance).toBe('-1')
    expect(wallet.version).toBe(0)
    expect(await fetchLedger(PROFILE_B)).toHaveLength(0)
  })

  it('throws NotFound for a missing wallet', async () => {
    const missing = uuidv7()
    await expect(
      service.credit(missing, 100n, { type: 'topup' }, 'credit-missing'),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('rejects a non-positive amount before touching the database', async () => {
    await expect(
      service.credit(PROFILE_A, 0n, { type: 'topup' }, 'credit-zero'),
    ).rejects.toBeInstanceOf(BadRequestException)
  })
})
