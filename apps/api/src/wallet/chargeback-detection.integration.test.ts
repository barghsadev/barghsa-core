/**
 * Real-PostgreSQL integration tests for provider chargeback detection
 * (T-04.2.04.02 / S-04.2.04).
 *
 * Proves against actual PostgreSQL:
 *   1. A signed, in-window chargeback maps to the Completed top-up
 *      credit and posts a compensating reversal via reverseTransaction.
 *   2. Tampered signatures never reverse.
 *   3. Duplicate event ids do not post a second reversal.
 *   4. An untraceable notification is stored as unmatched without
 *      rewriting wallet history.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { v7 as uuidv7 } from 'uuid'
import { createIsolatedTestDb, dropTestSchema } from '@barghsa/db/test'
import type { IsolatedTestDb } from '@barghsa/db/test'
import { ErrorCodes } from '@barghsa/shared/errors'
import { WALLET_CHARGEBACK_REASON } from '@barghsa/shared/finance'
import { WalletService } from './wallet.service.js'
import { ChargebackDetectionService } from './chargeback-detection.service.js'
import { onlineTopUpCreditIdempotencyKey } from './online-topup-callback.service.js'
import { signPaymentCallback } from './payment-callback-verifier.js'

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
const CHARGEBACK_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0075_create_wallet_chargeback_events.sql',
)

const PROFILE_A = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
const PROFILE_B = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb'
const PROFILE_C = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc'
const SECRET = 'integration-chargeback-secret'
const MERCHANT = 'barghsa-test-merchant'
const AMOUNT = 25_000n
const AUTHORITY = 'auth-chargeback-1'
const PROVIDER_REF = 'psp-chargeback-ref'

describe('ChargebackDetectionService — real PostgreSQL (T-04.2.04.02)', () => {
  let ctx: IsolatedTestDb
  let walletService: WalletService
  let service: ChargebackDetectionService
  let pendingId: string
  let creditId: string

  beforeAll(async () => {
    ctx = await createIsolatedTestDb('test_', 4)
    poolHolder.pool = ctx.pool
    walletService = new WalletService()
    service = new ChargebackDetectionService(walletService, {
      webhookSecret: SECRET,
      merchantId: MERCHANT,
    })

    await ctx.pool.query(readFileSync(UUIDV7_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
      )
    `)
    await ctx.pool.query(readFileSync(WALLET_TX_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(AVAILABLE_CHECK_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(REVERSAL_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(CHARGEBACK_MIGRATION, 'utf-8').trim())
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

    pendingId = uuidv7()
    const credit = await walletService.credit(
      PROFILE_A,
      AMOUNT,
      {
        type: 'topup',
        refId: PROVIDER_REF,
        description: 'Online wallet top-up',
        metadata: {
          channel: 'online',
          pendingTransactionId: pendingId,
          authority: AUTHORITY,
        },
      },
      onlineTopUpCreditIdempotencyKey(pendingId),
    )
    creditId = credit.id
  }, 60_000)

  afterAll(async () => {
    poolHolder.pool = null
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  function signed(body: Record<string, unknown>, eventId: string) {
    const rawBody = JSON.stringify(body)
    const timestamp = String(Math.floor(Date.now() / 1000))
    return {
      headers: {
        eventId,
        timestamp,
        signature: signPaymentCallback(rawBody, eventId, timestamp, SECRET),
      },
      rawBody,
    }
  }

  function chargebackBody(overrides: Record<string, unknown> = {}) {
    return {
      type: 'chargeback',
      merchantId: MERCHANT,
      merchantOrderId: pendingId,
      providerRefId: PROVIDER_REF,
      authority: AUTHORITY,
      amountIrR: AMOUNT.toString(),
      ...overrides,
    }
  }

  async function fetchWallet() {
    const result = await ctx.pool.query<{
      posted_balance: string
      reserved_balance: string
    }>(
      `SELECT posted_balance::text AS posted_balance, reserved_balance::text AS reserved_balance
       FROM wallets WHERE profile_id = $1`,
      [PROFILE_A],
    )
    return result.rows[0]!
  }

  it('maps a signed chargeback to the original credit and posts a reversal', async () => {
    const result = await service.handle(signed(chargebackBody(), 'evt-cb-int-1'))

    expect(result.mapped).toBe(true)
    expect(result.reversed).toBe(true)
    expect(result.originalTransactionId).toBe(creditId)
    expect(result.matchMethod).toBe('merchant_order_id')
    expect(result.status).toBe('reversed')

    const wallet = await fetchWallet()
    expect(wallet.posted_balance).toBe('0')

    const original = await ctx.pool.query<{ type: string; amount: string; state: string }>(
      `SELECT type, amount::text AS amount, state FROM wallet_transactions WHERE id = $1`,
      [creditId],
    )
    expect(original.rows[0]).toMatchObject({
      type: 'topup',
      amount: AMOUNT.toString(),
      state: 'Completed',
    })

    const reversal = await ctx.pool.query<{
      type: string
      amount: string
      reverses_transaction_id: string
      description: string
    }>(
      `SELECT type, amount::text AS amount, reverses_transaction_id, description
         FROM wallet_transactions WHERE id = $1`,
      [result.reversalTransactionId],
    )
    expect(reversal.rows[0]).toMatchObject({
      type: 'reversal',
      amount: (-AMOUNT).toString(),
      reverses_transaction_id: creditId,
      description: WALLET_CHARGEBACK_REASON,
    })
  })

  it('does not reverse on a tampered signature', async () => {
    const rawBody = JSON.stringify(chargebackBody())
    const timestamp = String(Math.floor(Date.now() / 1000))
    const rejection = await service
      .handle({
        headers: {
          eventId: 'evt-cb-bad-sig',
          timestamp,
          signature: signPaymentCallback(rawBody, 'evt-cb-bad-sig', timestamp, 'wrong-secret'),
        },
        rawBody,
      })
      .catch((error: unknown) => error)

    expect(rejection).toBeInstanceOf(HttpException)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      error: ErrorCodes.PROVIDER_CALLBACK_INVALID.code,
    })
    const events = await ctx.pool.query(
      `SELECT 1 FROM wallet_chargeback_events WHERE event_id = 'evt-cb-bad-sig'`,
    )
    expect(events.rows).toHaveLength(0)
  })

  it('replays a duplicate event id without a second reversal', async () => {
    const first = await service.handle(signed(chargebackBody(), 'evt-cb-int-1'))
    expect(first.processed).toBe(false)
    expect(first.reversed).toBe(true)
    expect(first.reversalTransactionId).toBeTruthy()

    const reversals = await ctx.pool.query(
      `SELECT id FROM wallet_transactions
        WHERE reverses_transaction_id = $1 AND type = 'reversal'`,
      [creditId],
    )
    expect(reversals.rows).toHaveLength(1)
  })

  it('stores an unmatched chargeback without rewriting the ledger', async () => {
    const unknownPending = uuidv7()
    const before = await ctx.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM wallet_transactions WHERE wallet_id = $1`,
      [PROFILE_A],
    )
    const result = await service.handle(
      signed(
        chargebackBody({
          merchantOrderId: unknownPending,
          providerRefId: 'unknown-ref',
          authority: 'unknown-authority',
        }),
        'evt-cb-unmatched',
      ),
    )
    expect(result).toMatchObject({
      mapped: false,
      reversed: false,
      status: 'unmatched',
    })
    const after = await ctx.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM wallet_transactions WHERE wallet_id = $1`,
      [PROFILE_A],
    )
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count)
    const event = await ctx.pool.query<{ status: string; original_transaction_id: string | null }>(
      `SELECT status, original_transaction_id
         FROM wallet_chargeback_events WHERE event_id = 'evt-cb-unmatched'`,
    )
    expect(event.rows[0]).toMatchObject({
      status: 'unmatched',
      original_transaction_id: null,
    })
  })

  it('maps a chargeback whose reversal cannot post and leaves the original intact', async () => {
    const pendingB = uuidv7()
    const credit = await walletService.credit(
      PROFILE_B,
      AMOUNT,
      {
        type: 'topup',
        refId: 'psp-shortfall',
        description: 'Online wallet top-up',
        metadata: { channel: 'online', pendingTransactionId: pendingB },
      },
      onlineTopUpCreditIdempotencyKey(pendingB),
    )
    await walletService.reserve(PROFILE_B, AMOUNT, `reserve-shortfall-${uuidv7()}`)

    const result = await service.handle(
      signed(
        {
          type: 'chargeback',
          merchantId: MERCHANT,
          merchantOrderId: pendingB,
          amountIrR: AMOUNT.toString(),
        },
        'evt-cb-unresolved',
      ),
    )
    expect(result).toMatchObject({
      mapped: true,
      reversed: false,
      originalTransactionId: credit.id,
      status: 'unresolved',
    })
    const original = await ctx.pool.query<{ state: string; amount: string }>(
      `SELECT state, amount::text AS amount FROM wallet_transactions WHERE id = $1`,
      [credit.id],
    )
    expect(original.rows[0]).toMatchObject({ state: 'Completed', amount: AMOUNT.toString() })
    const reversals = await ctx.pool.query(
      `SELECT id FROM wallet_transactions WHERE reverses_transaction_id = $1`,
      [credit.id],
    )
    expect(reversals.rows).toHaveLength(0)
  })

  it('maps an authority-only notification when the credit has a distinct provider ref', async () => {
    const pendingC = uuidv7()
    const authorityC = 'auth-chargeback-c'
    const providerRefC = 'psp-chargeback-ref-c'
    const credit = await walletService.credit(
      PROFILE_C,
      AMOUNT,
      {
        type: 'topup',
        refId: providerRefC,
        description: 'Online wallet top-up',
        metadata: {
          channel: 'online',
          pendingTransactionId: pendingC,
          authority: authorityC,
        },
      },
      onlineTopUpCreditIdempotencyKey(pendingC),
    )
    expect(credit.refId).toBe(providerRefC)
    expect(credit.refId).not.toBe(authorityC)

    const result = await service.handle(
      signed(
        {
          type: 'chargeback',
          merchantId: MERCHANT,
          authority: authorityC,
          amountIrR: AMOUNT.toString(),
        },
        'evt-cb-authority-only',
      ),
    )
    expect(result).toMatchObject({
      mapped: true,
      reversed: true,
      originalTransactionId: credit.id,
      matchMethod: 'authority',
      status: 'reversed',
    })

    const original = await ctx.pool.query<{ type: string; amount: string; state: string }>(
      `SELECT type, amount::text AS amount, state FROM wallet_transactions WHERE id = $1`,
      [credit.id],
    )
    expect(original.rows[0]).toMatchObject({
      type: 'topup',
      amount: AMOUNT.toString(),
      state: 'Completed',
    })
    const reversal = await ctx.pool.query<{
      type: string
      amount: string
      reverses_transaction_id: string
    }>(
      `SELECT type, amount::text AS amount, reverses_transaction_id
         FROM wallet_transactions WHERE id = $1`,
      [result.reversalTransactionId],
    )
    expect(reversal.rows[0]).toMatchObject({
      type: 'reversal',
      amount: (-AMOUNT).toString(),
      reverses_transaction_id: credit.id,
    })
  })
})
