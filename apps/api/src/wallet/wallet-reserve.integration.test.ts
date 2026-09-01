/**
 * Real-PostgreSQL integration tests for WalletService.reserve and
 * WalletService.release (T-04.2.01.05).
 *
 * Proves against actual PostgreSQL:
 *   1. A reserve checks availableBalance, increments reserved_balance
 *      (not posted_balance), and inserts a Reserved ledger row with a
 *      positive amount (version += 1).
 *   2. Retrying with the same idempotency key returns the original
 *      ledger row and does not double-reserve.
 *   3. Concurrent reserves with distinct keys both post when funds
 *      suffice; the final reserved_balance equals the start plus the sum.
 *   4. Concurrent same-key retries reserve only once.
 *   5. Insufficient availableBalance (including when reserved funds
 *      consume posted) is rejected and leaves the wallet/ledger unchanged.
 *   6. Concurrent over-reserve: exactly one succeeds when two amounts
 *      together exceed availableBalance.
 *   7. release() drops reserved_balance, leaves posted_balance unchanged,
 *      and advances the reservation to Released. Re-release is idempotent.
 *   8. A missing wallet / missing reservation is NotFound.
 *   9. Reusing a credit or debit idempotency key, retrying a reserve
 *      with a different amount/refId, or replaying a released key is
 *      ConflictException and does not mutate the wallet.
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
const PROFILE_C = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc'

describe('WalletService.reserve / release — real PostgreSQL (T-04.2.01.05)', () => {
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

  it('reserves: Reserved ledger row, reservedBalance rises, postedBalance is unchanged', async () => {
    const before = await fetchWallet(PROFILE_A)
    const tx = await service.reserve(
      PROFILE_A,
      250_000n,
      'reserve-happy-1',
      { refId: 'inv-1', description: 'hold for payment' },
    )

    expect(tx.state).toBe('Reserved')
    expect(tx.type).toBe('reservation')
    expect(tx.amount).toBe(250_000n)
    expect(tx.refId).toBe('inv-1')
    expect(tx.idempotencyKey).toBe('reserve-happy-1')
    expect(tx.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )

    const after = await fetchWallet(PROFILE_A)
    expect(BigInt(after.posted_balance)).toBe(BigInt(before.posted_balance))
    expect(BigInt(after.reserved_balance)).toBe(BigInt(before.reserved_balance) + 250_000n)
    expect(after.version).toBe(before.version + 1)

    const ledger = await fetchLedger(PROFILE_A)
    expect(ledger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: tx.id,
          type: 'reservation',
          amount: '250000',
          state: 'Reserved',
          idempotency_key: 'reserve-happy-1',
          ref_id: 'inv-1',
        }),
      ]),
    )
  })

  it('returns the original ledger row on idempotent retry without double-reserving', async () => {
    const first = await service.reserve(PROFILE_A, 10_000n, 'reserve-idem-1', { refId: 'inv-idem' })
    const afterFirst = await fetchWallet(PROFILE_A)

    const second = await service.reserve(PROFILE_A, 10_000n, 'reserve-idem-1', { refId: 'inv-idem' })
    const afterSecond = await fetchWallet(PROFILE_A)

    expect(second.id).toBe(first.id)
    expect(second.amount).toBe(10_000n)
    expect(second.state).toBe('Reserved')
    expect(afterSecond.posted_balance).toBe(afterFirst.posted_balance)
    expect(afterSecond.reserved_balance).toBe(afterFirst.reserved_balance)
    expect(afterSecond.version).toBe(afterFirst.version)

    const matching = (await fetchLedger(PROFILE_A)).filter(
      (row) => row.idempotency_key === 'reserve-idem-1',
    )
    expect(matching).toHaveLength(1)
  })

  it('retries the same idempotency key with uppercase/lowercase UUID spellings without changing the balance', async () => {
    const first = await service.reserve(PROFILE_A, 5_000n, 'reserve-uuid-case')
    const afterFirst = await fetchWallet(PROFILE_A)

    const second = await service.reserve(PROFILE_A.toUpperCase(), 5_000n, 'reserve-uuid-case')
    const afterSecond = await fetchWallet(PROFILE_A)

    expect(second.id).toBe(first.id)
    expect(second.walletId).toBe(PROFILE_A)
    expect(afterSecond.reserved_balance).toBe(afterFirst.reserved_balance)
    expect(afterSecond.version).toBe(afterFirst.version)
    expect(
      (await fetchLedger(PROFILE_A)).filter((row) => row.idempotency_key === 'reserve-uuid-case'),
    ).toHaveLength(1)
  })

  it('lets concurrent retries of the same idempotency key reserve only once', async () => {
    const before = await fetchWallet(PROFILE_A)
    const results = await Promise.all([
      service.reserve(PROFILE_A, 4_000n, 'reserve-concurrent-same'),
      service.reserve(PROFILE_A, 4_000n, 'reserve-concurrent-same'),
    ])

    expect(results[0]!.id).toBe(results[1]!.id)
    const after = await fetchWallet(PROFILE_A)
    expect(BigInt(after.posted_balance)).toBe(BigInt(before.posted_balance))
    expect(BigInt(after.reserved_balance)).toBe(BigInt(before.reserved_balance) + 4_000n)
    expect(after.version).toBe(before.version + 1)
    expect(
      (await fetchLedger(PROFILE_A)).filter((row) => row.idempotency_key === 'reserve-concurrent-same'),
    ).toHaveLength(1)
  })

  it('posts two concurrent reserves with distinct keys; reservedBalance equals start plus the sum', async () => {
    const before = await fetchWallet(PROFILE_A)
    const results = await Promise.all([
      service.reserve(PROFILE_A, 3_000n, 'reserve-concurrent-a'),
      service.reserve(PROFILE_A, 7_000n, 'reserve-concurrent-b'),
    ])

    expect(new Set(results.map((r) => r.id)).size).toBe(2)
    expect(results.every((r) => r.state === 'Reserved')).toBe(true)

    const after = await fetchWallet(PROFILE_A)
    expect(BigInt(after.posted_balance)).toBe(BigInt(before.posted_balance))
    expect(BigInt(after.reserved_balance)).toBe(BigInt(before.reserved_balance) + 10_000n)
    expect(after.version).toBe(before.version + 2)
  })

  it('rejects reserve when availableBalance is insufficient and writes no ledger row', async () => {
    await ctx.pool.query(
      `UPDATE wallets SET posted_balance = 50_000, reserved_balance = 0, version = 0 WHERE profile_id = $1`,
      [PROFILE_B],
    )

    await expect(service.reserve(PROFILE_B, 100_000n, 'reserve-insufficient')).rejects.toBeInstanceOf(
      BadRequestException,
    )

    const wallet = await fetchWallet(PROFILE_B)
    expect(wallet.posted_balance).toBe('50000')
    expect(wallet.reserved_balance).toBe('0')
    expect(wallet.version).toBe(0)
    expect(await fetchLedger(PROFILE_B)).toHaveLength(0)
  })

  it('rejects reserve when reserved funds leave availableBalance below the amount', async () => {
    await ctx.pool.query(
      `UPDATE wallets SET posted_balance = 200_000, reserved_balance = 150_000, version = 3 WHERE profile_id = $1`,
      [PROFILE_B],
    )

    await expect(service.reserve(PROFILE_B, 60_000n, 'reserve-reserved-blocks')).rejects.toBeInstanceOf(
      BadRequestException,
    )

    const wallet = await fetchWallet(PROFILE_B)
    expect(wallet.posted_balance).toBe('200000')
    expect(wallet.reserved_balance).toBe('150000')
    expect(wallet.version).toBe(3)
    expect(
      (await fetchLedger(PROFILE_B)).filter((row) => row.idempotency_key === 'reserve-reserved-blocks'),
    ).toHaveLength(0)
  })

  it('lets exactly one of two concurrent over-reserving holds succeed', async () => {
    await ctx.pool.query(
      `UPDATE wallets SET posted_balance = 100_000, reserved_balance = 0, version = 0 WHERE profile_id = $1`,
      [PROFILE_C],
    )

    const settled = await Promise.allSettled([
      service.reserve(PROFILE_C, 80_000n, 'reserve-overdraw-a'),
      service.reserve(PROFILE_C, 80_000n, 'reserve-overdraw-b'),
    ])

    const fulfilled = settled.filter((r) => r.status === 'fulfilled')
    const rejected = settled.filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException)

    const after = await fetchWallet(PROFILE_C)
    expect(BigInt(after.posted_balance)).toBe(100_000n)
    expect(BigInt(after.reserved_balance)).toBe(80_000n)
    expect(after.version).toBe(1)
    expect(await fetchLedger(PROFILE_C)).toHaveLength(1)
  })

  it('throws NotFound for a missing wallet', async () => {
    const missing = uuidv7()
    await expect(service.reserve(missing, 100n, 'reserve-missing')).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('rejects a non-positive amount before touching the database', async () => {
    await expect(service.reserve(PROFILE_A, 0n, 'reserve-zero')).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })

  it('rejects reserve that reuses a credit idempotency key without changing the balance', async () => {
    const creditTx = await service.credit(PROFILE_A, 1_000n, { type: 'topup' }, 'reserve-reuses-credit-key')
    const afterCredit = await fetchWallet(PROFILE_A)

    await expect(service.reserve(PROFILE_A, 1_000n, 'reserve-reuses-credit-key')).rejects.toBeInstanceOf(
      ConflictException,
    )

    const afterAttempt = await fetchWallet(PROFILE_A)
    expect(afterAttempt.posted_balance).toBe(afterCredit.posted_balance)
    expect(afterAttempt.reserved_balance).toBe(afterCredit.reserved_balance)
    expect(afterAttempt.version).toBe(afterCredit.version)
    expect(creditTx.amount).toBe(1_000n)
    expect(
      (await fetchLedger(PROFILE_A)).filter((row) => row.idempotency_key === 'reserve-reuses-credit-key'),
    ).toHaveLength(1)
  })

  it('rejects reserve that reuses a debit idempotency key without completing a hold', async () => {
    const debitTx = await service.debit(PROFILE_A, 1_000n, { type: 'payment' }, 'reserve-reuses-debit-key')
    const afterDebit = await fetchWallet(PROFILE_A)

    await expect(service.reserve(PROFILE_A, 1_000n, 'reserve-reuses-debit-key')).rejects.toBeInstanceOf(
      ConflictException,
    )

    const afterAttempt = await fetchWallet(PROFILE_A)
    expect(afterAttempt.posted_balance).toBe(afterDebit.posted_balance)
    expect(afterAttempt.reserved_balance).toBe(afterDebit.reserved_balance)
    expect(afterAttempt.version).toBe(afterDebit.version)
    expect(debitTx.amount).toBe(-1_000n)
    expect(
      (await fetchLedger(PROFILE_A)).filter((row) => row.idempotency_key === 'reserve-reuses-debit-key'),
    ).toHaveLength(1)
  })

  it('rejects a same-key reserve with a different amount without changing the balance', async () => {
    const first = await service.reserve(PROFILE_A, 2_000n, 'reserve-mismatch-amount', { refId: 'inv-amt' })
    const afterFirst = await fetchWallet(PROFILE_A)

    await expect(
      service.reserve(PROFILE_A, 3_000n, 'reserve-mismatch-amount', { refId: 'inv-amt' }),
    ).rejects.toBeInstanceOf(ConflictException)

    const afterAttempt = await fetchWallet(PROFILE_A)
    expect(afterAttempt.reserved_balance).toBe(afterFirst.reserved_balance)
    expect(afterAttempt.version).toBe(afterFirst.version)
    expect(first.amount).toBe(2_000n)
    expect(
      (await fetchLedger(PROFILE_A)).filter((row) => row.idempotency_key === 'reserve-mismatch-amount'),
    ).toHaveLength(1)
  })

  it('rejects a same-key reserve with a different refId without changing the balance', async () => {
    const first = await service.reserve(PROFILE_A, 1_500n, 'reserve-mismatch-ref', { refId: 'inv-ref-a' })
    const afterFirst = await fetchWallet(PROFILE_A)

    await expect(
      service.reserve(PROFILE_A, 1_500n, 'reserve-mismatch-ref', { refId: 'inv-ref-b' }),
    ).rejects.toBeInstanceOf(ConflictException)

    const afterAttempt = await fetchWallet(PROFILE_A)
    expect(afterAttempt.reserved_balance).toBe(afterFirst.reserved_balance)
    expect(afterAttempt.version).toBe(afterFirst.version)
    expect(first.refId).toBe('inv-ref-a')
    expect(
      (await fetchLedger(PROFILE_A)).filter((row) => row.idempotency_key === 'reserve-mismatch-ref'),
    ).toEqual([
      expect.objectContaining({
        amount: '1500',
        ref_id: 'inv-ref-a',
      }),
    ])
  })

  it('release drops reservedBalance, leaves postedBalance unchanged, and marks the row Released', async () => {
    const hold = await service.reserve(PROFILE_A, 8_000n, 'reserve-then-release')
    const afterReserve = await fetchWallet(PROFILE_A)

    const released = await service.release(hold.id)
    const afterRelease = await fetchWallet(PROFILE_A)

    expect(released.id).toBe(hold.id)
    expect(released.state).toBe('Released')
    expect(released.amount).toBe(8_000n)
    expect(BigInt(afterRelease.posted_balance)).toBe(BigInt(afterReserve.posted_balance))
    expect(BigInt(afterRelease.reserved_balance)).toBe(BigInt(afterReserve.reserved_balance) - 8_000n)
    expect(afterRelease.version).toBe(afterReserve.version + 1)
    expect(
      (await fetchLedger(PROFILE_A)).filter((row) => row.idempotency_key === 'reserve-then-release'),
    ).toEqual([
      expect.objectContaining({
        id: hold.id,
        type: 'reservation',
        amount: '8000',
        state: 'Released',
      }),
    ])
  })

  it('re-release is idempotent and does not decrement reservedBalance twice', async () => {
    const hold = await service.reserve(PROFILE_A, 6_000n, 'reserve-rerelease')
    const first = await service.release(hold.id)
    const afterFirst = await fetchWallet(PROFILE_A)

    const second = await service.release(hold.id)
    const afterSecond = await fetchWallet(PROFILE_A)

    expect(second.id).toBe(first.id)
    expect(second.state).toBe('Released')
    expect(afterSecond.reserved_balance).toBe(afterFirst.reserved_balance)
    expect(afterSecond.posted_balance).toBe(afterFirst.posted_balance)
    expect(afterSecond.version).toBe(afterFirst.version)
  })

  it('lets concurrent releases of the same reservation decrement reservedBalance only once', async () => {
    const hold = await service.reserve(PROFILE_A, 9_000n, 'reserve-concurrent-release')
    const before = await fetchWallet(PROFILE_A)

    const results = await Promise.all([service.release(hold.id), service.release(hold.id)])

    expect(results[0]!.id).toBe(results[1]!.id)
    expect(results.every((r) => r.state === 'Released')).toBe(true)
    const after = await fetchWallet(PROFILE_A)
    expect(BigInt(after.posted_balance)).toBe(BigInt(before.posted_balance))
    expect(BigInt(after.reserved_balance)).toBe(BigInt(before.reserved_balance) - 9_000n)
    expect(after.version).toBe(before.version + 1)
  })

  it('rejects replaying a released reservation key as a new hold', async () => {
    const hold = await service.reserve(PROFILE_A, 2_500n, 'reserve-replay-released')
    await service.release(hold.id)
    const afterRelease = await fetchWallet(PROFILE_A)

    await expect(service.reserve(PROFILE_A, 2_500n, 'reserve-replay-released')).rejects.toBeInstanceOf(
      ConflictException,
    )

    const afterAttempt = await fetchWallet(PROFILE_A)
    expect(afterAttempt.reserved_balance).toBe(afterRelease.reserved_balance)
    expect(afterAttempt.version).toBe(afterRelease.version)
  })

  it('throws NotFound for a missing reservation id', async () => {
    await expect(service.release(uuidv7())).rejects.toBeInstanceOf(NotFoundException)
  })

  it('rejects release of a non-reservation ledger row', async () => {
    const credit = await service.credit(PROFILE_A, 500n, { type: 'topup' }, 'release-not-reservation')
    const before = await fetchWallet(PROFILE_A)

    await expect(service.release(credit.id)).rejects.toBeInstanceOf(ConflictException)

    const after = await fetchWallet(PROFILE_A)
    expect(after.posted_balance).toBe(before.posted_balance)
    expect(after.reserved_balance).toBe(before.reserved_balance)
    expect(after.version).toBe(before.version)
  })
})
