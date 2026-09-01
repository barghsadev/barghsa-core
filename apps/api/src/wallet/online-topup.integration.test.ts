/**
 * Real-PostgreSQL integration tests for online top-up initiation
 * (T-04.2.02.01).
 *
 * Proves against actual PostgreSQL:
 *   1. A valid amount creates a Pending topup ledger row and does not
 *      change posted_balance or reserved_balance.
 *   2. Amounts above the configured (or default) limit are rejected
 *      before any ledger insert.
 *   3. Retrying with the same idempotency key returns the original
 *      Pending row and does not insert a second transaction.
 *   4. A colliding key with a different amount is ConflictException.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { BadRequestException, ConflictException } from '@nestjs/common'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from '@barghsa/db/test'
import type { IsolatedTestDb } from '@barghsa/db/test'
import { WalletService } from './wallet.service.js'
import { OnlineTopUpService } from './online-topup.service.js'
import type { PaymentGateway } from './payment-gateway.js'

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

describe('OnlineTopUpService — real PostgreSQL (T-04.2.02.01)', () => {
  let ctx: IsolatedTestDb
  let walletService: WalletService
  let gateway: PaymentGateway
  let service: OnlineTopUpService
  let startCalls: number

  beforeAll(async () => {
    ctx = await createIsolatedTestDb('test_', 4)
    poolHolder.pool = ctx.pool
    walletService = new WalletService()
    startCalls = 0
    gateway = {
      async startPayment(request) {
        startCalls += 1
        return {
          authority: `auth-${request.merchantOrderId}`,
          redirectUrl: `https://pay.test/start?order=${request.merchantOrderId}&amount=${request.amountIrR.toString()}`,
        }
      },
    }
    service = new OnlineTopUpService(walletService, gateway)

    await ctx.pool.query(readFileSync(UUIDV7_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
      )
    `)
    await ctx.pool.query(readFileSync(WALLET_TX_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS app_config (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await ctx.pool.query(`INSERT INTO profiles (id) VALUES ($1), ($2)`, [PROFILE_A, PROFILE_B])
    await ctx.pool.query(`INSERT INTO wallets (profile_id) VALUES ($1)`, [PROFILE_A])
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
      metadata: unknown
    }>(
      `SELECT id, type, amount::text AS amount, state, idempotency_key, ref_id, metadata
       FROM wallet_transactions
       WHERE wallet_id = $1
       ORDER BY created_at, id`,
      [profileId],
    )
    return result.rows
  }

  it('creates a Pending top-up, stores the gateway session, and leaves balances unchanged', async () => {
    const before = await fetchWallet(PROFILE_A)
    const result = await service.initiate({
      profileId: PROFILE_A,
      amountIrR: 250_000n,
      idempotencyKey: 'online-topup-happy',
    })

    expect(result.state).toBe('Pending')
    expect(result.amount).toBe(250_000n)
    expect(result.redirectUrl).toContain('order=')
    expect(result.redirectUrl).toContain('amount=250000')

    const after = await fetchWallet(PROFILE_A)
    expect(after.posted_balance).toBe(before.posted_balance)
    expect(after.reserved_balance).toBe(before.reserved_balance)
    expect(after.version).toBe(before.version)

    const ledger = await fetchLedger(PROFILE_A)
    const row = ledger.find((entry) => entry.idempotency_key === 'online-topup-happy')
    expect(row).toMatchObject({
      type: 'topup',
      amount: '250000',
      state: 'Pending',
    })
    expect(row!.ref_id).toBe(`auth-${row!.id}`)
    expect(row!.metadata).toMatchObject({
      channel: 'online',
      gateway: {
        authority: `auth-${row!.id}`,
        redirectUrl: result.redirectUrl,
      },
    })
  })

  it('creates the wallet when missing and still inserts a Pending top-up', async () => {
    const result = await service.initiate({
      profileId: PROFILE_B,
      amountIrR: 1_000n,
      idempotencyKey: 'online-topup-new-wallet',
    })
    expect(result.state).toBe('Pending')
    const wallet = await fetchWallet(PROFILE_B)
    expect(wallet.posted_balance).toBe('0')
    expect(wallet.reserved_balance).toBe('0')
  })

  it('rejects an amount above the default 2e9 IRR limit without inserting a ledger row', async () => {
    await expect(
      service.initiate({
        profileId: PROFILE_A,
        amountIrR: 2_000_000_001n,
        idempotencyKey: 'online-topup-over-default',
      }),
    ).rejects.toBeInstanceOf(BadRequestException)

    const ledger = await fetchLedger(PROFILE_A)
    expect(ledger.some((row) => row.idempotency_key === 'online-topup-over-default')).toBe(false)
  })

  it('enforces a persisted admin limit at submission', async () => {
    await ctx.pool.query(
      `INSERT INTO app_config (key, value) VALUES ('finance.wallet_top_up_limit', $1::jsonb)`,
      [JSON.stringify({ limit_irr: 50_000 })],
    )
    try {
      await expect(
        service.initiate({
          profileId: PROFILE_A,
          amountIrR: 50_001n,
          idempotencyKey: 'online-topup-over-admin',
        }),
      ).rejects.toBeInstanceOf(BadRequestException)

      const ok = await service.initiate({
        profileId: PROFILE_A,
        amountIrR: 50_000n,
        idempotencyKey: 'online-topup-at-admin',
      })
      expect(ok.amount).toBe(50_000n)
    } finally {
      await ctx.pool.query(`DELETE FROM app_config WHERE key = 'finance.wallet_top_up_limit'`)
    }
  })

  it('replays the same Pending row and redirect on idempotent retry', async () => {
    const startsBefore = startCalls
    const first = await service.initiate({
      profileId: PROFILE_A,
      amountIrR: 10_000n,
      idempotencyKey: 'online-topup-retry',
    })
    const second = await service.initiate({
      profileId: PROFILE_A,
      amountIrR: 10_000n,
      idempotencyKey: 'online-topup-retry',
    })

    expect(second.transactionId).toBe(first.transactionId)
    expect(second.redirectUrl).toBe(first.redirectUrl)
    expect(startCalls).toBe(startsBefore + 1)

    const ledger = await fetchLedger(PROFILE_A)
    expect(ledger.filter((row) => row.idempotency_key === 'online-topup-retry')).toHaveLength(1)
  })

  it('retries the same idempotency key with uppercase/lowercase UUID spellings', async () => {
    const first = await service.initiate({
      profileId: PROFILE_A,
      amountIrR: 7_000n,
      idempotencyKey: 'online-topup-uuid-case',
    })
    const second = await service.initiate({
      profileId: PROFILE_A.toUpperCase(),
      amountIrR: 7_000n,
      idempotencyKey: 'online-topup-uuid-case',
    })

    expect(second.transactionId).toBe(first.transactionId)
    expect(second.redirectUrl).toBe(first.redirectUrl)

    const ledger = await fetchLedger(PROFILE_A)
    const matching = ledger.filter((row) => row.idempotency_key === 'online-topup-uuid-case')
    expect(matching).toHaveLength(1)
    expect(matching[0]!.id).toBe(first.transactionId)
  })

  it('rejects a colliding idempotency key with a different amount', async () => {
    await service.initiate({
      profileId: PROFILE_A,
      amountIrR: 3_000n,
      idempotencyKey: 'online-topup-collision',
    })
    await expect(
      service.initiate({
        profileId: PROFILE_A,
        amountIrR: 4_000n,
        idempotencyKey: 'online-topup-collision',
      }),
    ).rejects.toBeInstanceOf(ConflictException)
  })
})
