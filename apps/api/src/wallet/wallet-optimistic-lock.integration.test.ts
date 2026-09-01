/**
 * Real-PostgreSQL integration tests for WalletService.applyPostedBalanceDelta
 * (T-04.2.01.06).
 *
 * Proves against actual PostgreSQL:
 *   1. Matching `expectedVersion` applies `posted_balance += delta` and
 *      `version += 1` in one UPDATE.
 *   2. A stale `expectedVersion` throws ConflictException and leaves the
 *      wallet unchanged.
 *   3. Two concurrent updates with the same expectedVersion: exactly one
 *      succeeds; posted_balance equals start + the winner's delta.
 *   4. A negative delta decreases posted_balance under the same predicate.
 *   5. A missing wallet is ConflictException (zero rows matched).
 *   6. Mixed-case UUID spellings address the same `profile_id` row
 *      (`WHERE profile_id = $2::uuid`).
 *   7. A non-UUID wallet id is BadRequestException and mutates nothing.
 *
 * Wiring: only `getDbPool()` is stubbed, handing the service the
 * schema-scoped Testcontainers pool.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { BadRequestException, ConflictException } from '@nestjs/common'
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

describe('WalletService.applyPostedBalanceDelta — real PostgreSQL (T-04.2.01.06)', () => {
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
    await ctx.pool.query(
      `INSERT INTO wallets (profile_id, posted_balance, reserved_balance, version)
       VALUES ($1, 1_000_000, 0, 0), ($2, 500_000, 0, 3)`,
      [PROFILE_A, PROFILE_B],
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

  it('applies postedBalance += delta and version += 1 when expectedVersion matches', async () => {
    const before = await fetchWallet(PROFILE_A)
    const updated = await service.applyPostedBalanceDelta(PROFILE_A, 250_000n, before.version)

    expect(updated.postedBalance).toBe(BigInt(before.posted_balance) + 250_000n)
    expect(updated.version).toBe(before.version + 1)
    expect(updated.reservedBalance).toBe(BigInt(before.reserved_balance))
    expect(updated.availableBalance).toBe(updated.postedBalance - updated.reservedBalance)

    const after = await fetchWallet(PROFILE_A)
    expect(BigInt(after.posted_balance)).toBe(updated.postedBalance)
    expect(after.version).toBe(updated.version)
    expect(after.reserved_balance).toBe(before.reserved_balance)
  })

  it('rejects a stale expectedVersion and leaves postedBalance + version unchanged', async () => {
    const before = await fetchWallet(PROFILE_A)

    await expect(
      service.applyPostedBalanceDelta(PROFILE_A, 10_000n, before.version + 99),
    ).rejects.toBeInstanceOf(ConflictException)

    const after = await fetchWallet(PROFILE_A)
    expect(after.posted_balance).toBe(before.posted_balance)
    expect(after.version).toBe(before.version)
  })

  it('lets exactly one of two concurrent same-version updates win', async () => {
    const before = await fetchWallet(PROFILE_B)
    const results = await Promise.allSettled([
      service.applyPostedBalanceDelta(PROFILE_B, 3_000n, before.version),
      service.applyPostedBalanceDelta(PROFILE_B, 7_000n, before.version),
    ])

    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<WalletService['applyPostedBalanceDelta']>>> =>
        r.status === 'fulfilled',
    )
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({
      status: 'rejected',
      reason: expect.any(ConflictException),
    })

    const winner = fulfilled[0]!.value
    const appliedDelta = winner.postedBalance - BigInt(before.posted_balance)
    expect([3_000n, 7_000n]).toContain(appliedDelta)
    expect(winner.version).toBe(before.version + 1)

    const after = await fetchWallet(PROFILE_B)
    expect(after.version).toBe(before.version + 1)
    expect(BigInt(after.posted_balance)).toBe(winner.postedBalance)
  })

  it('applies a negative delta under the same version predicate', async () => {
    const before = await fetchWallet(PROFILE_A)
    const updated = await service.applyPostedBalanceDelta(PROFILE_A, -40_000n, before.version)

    expect(updated.postedBalance).toBe(BigInt(before.posted_balance) - 40_000n)
    expect(updated.version).toBe(before.version + 1)

    const after = await fetchWallet(PROFILE_A)
    expect(BigInt(after.posted_balance)).toBe(updated.postedBalance)
    expect(after.version).toBe(updated.version)
  })

  it('throws ConflictException for a missing wallet', async () => {
    const missing = uuidv7()
    await expect(service.applyPostedBalanceDelta(missing, 100n, 0)).rejects.toBeInstanceOf(
      ConflictException,
    )
  })

  it('applies the delta when walletId uses a mixed-case UUID spelling', async () => {
    const before = await fetchWallet(PROFILE_A)
    const updated = await service.applyPostedBalanceDelta(
      PROFILE_A.toUpperCase(),
      15_000n,
      before.version,
    )

    expect(updated.profileId).toBe(PROFILE_A)
    expect(updated.postedBalance).toBe(BigInt(before.posted_balance) + 15_000n)
    expect(updated.version).toBe(before.version + 1)

    const after = await fetchWallet(PROFILE_A)
    expect(BigInt(after.posted_balance)).toBe(updated.postedBalance)
    expect(after.version).toBe(updated.version)
  })

  it('rejects a non-UUID wallet id without mutating any wallet', async () => {
    const beforeA = await fetchWallet(PROFILE_A)
    const beforeB = await fetchWallet(PROFILE_B)

    await expect(service.applyPostedBalanceDelta('not-a-uuid', 100n, 0)).rejects.toBeInstanceOf(
      BadRequestException,
    )

    expect(await fetchWallet(PROFILE_A)).toEqual(beforeA)
    expect(await fetchWallet(PROFILE_B)).toEqual(beforeB)
  })
})
