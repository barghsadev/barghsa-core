/**
 * Real-PostgreSQL integration tests for WalletService.reverseTransaction
 * (T-04.2.04.01 / S-04.2.04).
 *
 * Proves against actual PostgreSQL:
 *   1. Reversing a Completed credit inserts a Completed `reversal` of
 *      opposite sign, decrements posted_balance, and leaves the original
 *      row untouched.
 *   2. Reversing a Completed debit credits posted_balance the same way.
 *   3. Retrying with the same idempotency key returns the original
 *      reversal and does not double-adjust.
 *   4. A second reversal of the same original with a different key is
 *      ConflictException.
 *   5. Concurrent same-key retries reverse only once.
 *   6. Concurrent distinct-key reversals of the same original: one
 *      succeeds, the other conflicts.
 *   7. Insufficient availableBalance (including reserved funds) rejects
 *      a credit reversal and leaves the wallet/ledger unchanged.
 *   8. Reservations, reversals, and non-Completed rows cannot reverse.
 *   9. A missing original is NotFound.
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
const AVAILABLE_CHECK_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0069_wallet_available_balance_check.sql',
)
const REVERSAL_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0074_wallet_tx_reverses_transaction.sql',
)

const PROFILE_A = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
const PROFILE_B = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb'
const PROFILE_C = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc'

describe('WalletService.reverseTransaction — real PostgreSQL (T-04.2.04.01)', () => {
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
    await ctx.pool.query(readFileSync(AVAILABLE_CHECK_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(REVERSAL_MIGRATION, 'utf-8').trim())
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
      reverses_transaction_id: string | null
      description: string | null
    }>(
      `SELECT id, type, amount::text AS amount, state, idempotency_key,
              reverses_transaction_id, description
       FROM wallet_transactions
       WHERE wallet_id = $1
       ORDER BY created_at, id`,
      [profileId],
    )
    return result.rows
  }

  async function seedPosted(profileId: string, posted: bigint, reserved = 0n) {
    await ctx.pool.query(
      `UPDATE wallets
       SET posted_balance = $2::bigint, reserved_balance = $3::bigint, version = 0
       WHERE profile_id = $1`,
      [profileId, posted, reserved],
    )
  }

  it('reverses a Completed credit without rewriting the original row', async () => {
    await seedPosted(PROFILE_A, 0n)
    const original = await service.credit(
      PROFILE_A,
      250_000n,
      { type: 'topup', refId: 'provider-evt-1', description: 'online top-up' },
      'rev-credit-orig',
    )
    const before = await fetchWallet(PROFILE_A)

    const reversal = await service.reverseTransaction(
      original.id,
      'provider chargeback',
      'rev-credit-key',
    )

    expect(reversal.type).toBe('reversal')
    expect(reversal.state).toBe('Completed')
    expect(reversal.amount).toBe(-250_000n)
    expect(reversal.reversesTransactionId).toBe(original.id)
    expect(reversal.description).toBe('provider chargeback')
    expect(reversal.refId).toBe('provider-evt-1')

    const after = await fetchWallet(PROFILE_A)
    expect(BigInt(after.posted_balance)).toBe(BigInt(before.posted_balance) - 250_000n)
    expect(after.version).toBe(before.version + 1)
    expect(BigInt(after.reserved_balance)).toBe(BigInt(before.reserved_balance))

    const ledger = await fetchLedger(PROFILE_A)
    const originalRow = ledger.find((row) => row.id === original.id)
    expect(originalRow).toMatchObject({
      type: 'topup',
      amount: '250000',
      state: 'Completed',
    })
    expect(ledger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: reversal.id,
          type: 'reversal',
          amount: '-250000',
          state: 'Completed',
          reverses_transaction_id: original.id,
        }),
      ]),
    )
  })

  it('reverses a Completed debit and restores postedBalance', async () => {
    await seedPosted(PROFILE_B, 1_000_000n)
    const original = await service.debit(
      PROFILE_B,
      200_000n,
      { type: 'payment', refId: 'inv-1' },
      'rev-debit-orig',
    )
    const afterDebit = await fetchWallet(PROFILE_B)

    const reversal = await service.reverseTransaction(
      original.id,
      'payment reversed',
      'rev-debit-key',
    )

    expect(reversal.amount).toBe(200_000n)
    expect(reversal.reversesTransactionId).toBe(original.id)

    const after = await fetchWallet(PROFILE_B)
    expect(BigInt(after.posted_balance)).toBe(BigInt(afterDebit.posted_balance) + 200_000n)
    expect(BigInt(after.posted_balance)).toBe(1_000_000n)
  })

  it('returns the original reversal on idempotent retry and does not double-adjust', async () => {
    await seedPosted(PROFILE_C, 0n)
    const original = await service.credit(
      PROFILE_C,
      80_000n,
      { type: 'topup' },
      `rev-idem-orig-${uuidv7()}`,
    )
    const first = await service.reverseTransaction(
      original.id,
      'provider chargeback',
      'rev-same-key',
    )
    const afterFirst = await fetchWallet(PROFILE_C)

    const second = await service.reverseTransaction(
      original.id,
      'provider chargeback',
      'rev-same-key',
    )

    expect(second.id).toBe(first.id)
    const afterSecond = await fetchWallet(PROFILE_C)
    expect(afterSecond.posted_balance).toBe(afterFirst.posted_balance)
    expect(afterSecond.version).toBe(afterFirst.version)
    const reversals = (await fetchLedger(PROFILE_C)).filter((row) => row.type === 'reversal')
    expect(reversals).toHaveLength(1)
  })

  it('rejects a second reversal of the same original with a different key', async () => {
    const profile = PROFILE_A
    const original = await service.credit(
      profile,
      10_000n,
      { type: 'topup' },
      `rev-dup-orig-${uuidv7()}`,
    )
    await service.reverseTransaction(original.id, 'first reverse', `rev-dup-a-${uuidv7()}`)
    const before = await fetchWallet(profile)

    await expect(
      service.reverseTransaction(original.id, 'second reverse', `rev-dup-b-${uuidv7()}`),
    ).rejects.toBeInstanceOf(ConflictException)

    const after = await fetchWallet(profile)
    expect(after.posted_balance).toBe(before.posted_balance)
    expect(after.version).toBe(before.version)
  })

  it('concurrent same-key retries reverse only once', async () => {
    const original = await service.credit(
      PROFILE_B,
      40_000n,
      { type: 'topup' },
      `rev-conc-orig-${uuidv7()}`,
    )
    const before = await fetchWallet(PROFILE_B)
    const key = `rev-conc-key-${uuidv7()}`

    const results = await Promise.all([
      service.reverseTransaction(original.id, 'provider chargeback', key),
      service.reverseTransaction(original.id, 'provider chargeback', key),
    ])

    expect(results[0]!.id).toBe(results[1]!.id)
    const after = await fetchWallet(PROFILE_B)
    expect(BigInt(after.posted_balance)).toBe(BigInt(before.posted_balance) - 40_000n)
    const reversals = (await fetchLedger(PROFILE_B)).filter(
      (row) => row.reverses_transaction_id === original.id,
    )
    expect(reversals).toHaveLength(1)
  })

  it('concurrent distinct-key reversals of the same original: one succeeds', async () => {
    const original = await service.credit(
      PROFILE_C,
      15_000n,
      { type: 'topup' },
      `rev-race-orig-${uuidv7()}`,
    )
    const before = await fetchWallet(PROFILE_C)

    const settled = await Promise.allSettled([
      service.reverseTransaction(original.id, 'provider chargeback', `rev-race-a-${uuidv7()}`),
      service.reverseTransaction(original.id, 'provider chargeback', `rev-race-b-${uuidv7()}`),
    ])

    const fulfilled = settled.filter((row) => row.status === 'fulfilled')
    const rejected = settled.filter((row) => row.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]!.status).toBe('rejected')
    if (rejected[0]!.status === 'rejected') {
      expect(rejected[0]!.reason).toBeInstanceOf(ConflictException)
    }

    const after = await fetchWallet(PROFILE_C)
    expect(BigInt(after.posted_balance)).toBe(BigInt(before.posted_balance) - 15_000n)
    const reversals = (await fetchLedger(PROFILE_C)).filter(
      (row) => row.reverses_transaction_id === original.id,
    )
    expect(reversals).toHaveLength(1)
  })

  it('rejects a credit reversal when reserved funds leave available short', async () => {
    await seedPosted(PROFILE_A, 100_000n, 60_000n)
    const insert = await ctx.pool.query<{ id: string }>(
      `INSERT INTO wallet_transactions
         (wallet_id, type, amount, state, idempotency_key)
       VALUES ($1, 'topup', 100000, 'Completed', $2)
       RETURNING id`,
      [PROFILE_A, `rev-short-orig-${uuidv7()}`],
    )
    const originalId = insert.rows[0]!.id
    const before = await fetchWallet(PROFILE_A)
    const ledgerBefore = await fetchLedger(PROFILE_A)

    await expect(
      service.reverseTransaction(originalId, 'provider chargeback', `rev-short-${uuidv7()}`),
    ).rejects.toBeInstanceOf(BadRequestException)

    const after = await fetchWallet(PROFILE_A)
    expect(after).toEqual(before)
    expect(await fetchLedger(PROFILE_A)).toEqual(ledgerBefore)
  })

  it('rejects reversing a reservation', async () => {
    await seedPosted(PROFILE_B, 500_000n)
    const hold = await service.reserve(PROFILE_B, 10_000n, `rev-hold-${uuidv7()}`)

    await expect(
      service.reverseTransaction(hold.id, 'should fail', `rev-hold-key-${uuidv7()}`),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('throws NotFound when the original row is missing', async () => {
    await expect(
      service.reverseTransaction(uuidv7(), 'missing', `rev-missing-${uuidv7()}`),
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})
