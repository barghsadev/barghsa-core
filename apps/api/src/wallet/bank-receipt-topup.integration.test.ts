/**
 * Real-PostgreSQL integration tests for bank-receipt top-up submission
 * (T-04.2.02.03).
 *
 * Proves against actual PostgreSQL:
 *   1. A valid receipt creates a Pending topup ledger row and does not
 *      change posted_balance or reserved_balance (no credit).
 *   2. Amounts above the online top-up limit are accepted.
 *   3. Retrying with the same idempotency key returns the original
 *      Pending row and does not insert a second transaction.
 *   4. A colliding key with a different receipt is ConflictException.
 *   5. A missing storage_records row is rejected before insert.
 *   6. Concurrent same-key retries insert exactly one Pending row.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { ConflictException, HttpException } from '@nestjs/common'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from '@barghsa/db/test'
import type { IsolatedTestDb } from '@barghsa/db/test'
import { BANK_RECEIPT_TOPUP_CHANNEL } from '@barghsa/shared/finance'
import { WalletService } from './wallet.service.js'
import { BankReceiptTopUpService } from './bank-receipt-topup.service.js'

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
const ATTACHMENT = 'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf'
const OTHER_ATTACHMENT = 'uploads/image/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg'

describe('BankReceiptTopUpService — real PostgreSQL (T-04.2.02.03)', () => {
  let ctx: IsolatedTestDb
  let walletService: WalletService
  let service: BankReceiptTopUpService

  beforeAll(async () => {
    ctx = await createIsolatedTestDb('test_', 4)
    poolHolder.pool = ctx.pool
    walletService = new WalletService()
    service = new BankReceiptTopUpService(walletService)

    await ctx.pool.query(readFileSync(UUIDV7_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
      )
    `)
    await ctx.pool.query(readFileSync(WALLET_TX_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS storage_records (
        storage_key TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'immutable', 'removed'))
      )
    `)
    await ctx.pool.query(`INSERT INTO profiles (id) VALUES ($1), ($2)`, [PROFILE_A, PROFILE_B])
    await ctx.pool.query(`INSERT INTO wallets (profile_id) VALUES ($1)`, [PROFILE_A])
    await ctx.pool.query(
      `INSERT INTO storage_records (storage_key, status) VALUES ($1, 'active'), ($2, 'active')`,
      [ATTACHMENT, OTHER_ATTACHMENT],
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
      metadata: unknown
    }>(
      `SELECT id, type, amount::text AS amount, state, idempotency_key, metadata
       FROM wallet_transactions
       WHERE wallet_id = $1
       ORDER BY created_at, id`,
      [profileId],
    )
    return result.rows
  }

  function payload(overrides: Record<string, unknown> = {}) {
    return {
      profileId: PROFILE_A,
      amount: 250_000,
      paymentDate: '2026-08-15',
      payerReference: 'TRK-998877',
      attachmentKey: ATTACHMENT,
      customerNote: 'Branch transfer',
      idempotencyKey: 'bank-receipt-happy',
      ...overrides,
    }
  }

  it('creates a Pending top-up and leaves balances unchanged', async () => {
    const before = await fetchWallet(PROFILE_A)
    const result = await service.submit(payload())

    expect(result.state).toBe('Pending')
    expect(result.amount).toBe(250_000n)
    expect(result.attachmentKey).toBe(ATTACHMENT)

    const after = await fetchWallet(PROFILE_A)
    expect(after.posted_balance).toBe(before.posted_balance)
    expect(after.reserved_balance).toBe(before.reserved_balance)
    expect(after.version).toBe(before.version)

    const ledger = await fetchLedger(PROFILE_A)
    const row = ledger.find((entry) => entry.idempotency_key === 'bank-receipt-happy')
    expect(row).toMatchObject({
      type: 'topup',
      amount: '250000',
      state: 'Pending',
    })
    expect(row!.metadata).toMatchObject({
      channel: BANK_RECEIPT_TOPUP_CHANNEL,
      receipt: {
        paymentDate: '2026-08-15',
        payerReference: 'TRK-998877',
        attachmentKey: ATTACHMENT,
        customerNote: 'Branch transfer',
      },
    })
  })

  it('accepts an amount above the online top-up limit', async () => {
    const result = await service.submit(
      payload({
        amount: 3_000_000_000,
        idempotencyKey: 'bank-receipt-over-online-limit',
      }),
    )
    expect(result.state).toBe('Pending')
    expect(result.amount).toBe(3_000_000_000n)
    const after = await fetchWallet(PROFILE_A)
    expect(after.posted_balance).toBe('0')
  })

  it('creates the wallet when missing and still inserts a Pending top-up', async () => {
    const result = await service.submit(
      payload({
        profileId: PROFILE_B,
        idempotencyKey: 'bank-receipt-new-wallet',
      }),
    )
    expect(result.state).toBe('Pending')
    const wallet = await fetchWallet(PROFILE_B)
    expect(wallet.posted_balance).toBe('0')
    expect(wallet.reserved_balance).toBe('0')
  })

  it('reuses the original Pending row on idempotent retry', async () => {
    const first = await service.submit(
      payload({ idempotencyKey: 'bank-receipt-retry' }),
    )
    const second = await service.submit(
      payload({ idempotencyKey: 'bank-receipt-retry' }),
    )
    expect(second.transactionId).toBe(first.transactionId)
    const ledger = await fetchLedger(PROFILE_A)
    expect(ledger.filter((row) => row.idempotency_key === 'bank-receipt-retry')).toHaveLength(1)
  })

  it('conflicts when the same key is reused with a different receipt', async () => {
    await service.submit(payload({ idempotencyKey: 'bank-receipt-conflict' }))
    await expect(
      service.submit(
        payload({
          idempotencyKey: 'bank-receipt-conflict',
          amount: 1000,
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('rejects an attachment that was never recorded', async () => {
    const rejection = await service
      .submit(
        payload({
          idempotencyKey: 'bank-receipt-missing-file',
          attachmentKey: 'uploads/document/ffffffff-ffff-4fff-8fff-ffffffffffff.pdf',
        }),
      )
      .catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(HttpException)
    const ledger = await fetchLedger(PROFILE_A)
    expect(ledger.some((row) => row.idempotency_key === 'bank-receipt-missing-file')).toBe(false)
  })

  it('serializes concurrent retries onto a single Pending row', async () => {
    const key = 'bank-receipt-concurrent'
    const [a, b] = await Promise.all([
      service.submit(payload({ idempotencyKey: key })),
      service.submit(payload({ idempotencyKey: key })),
    ])
    expect(a.transactionId).toBe(b.transactionId)
    const ledger = await fetchLedger(PROFILE_A)
    expect(ledger.filter((row) => row.idempotency_key === key)).toHaveLength(1)
  })
})
