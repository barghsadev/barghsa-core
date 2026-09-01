/**
 * Real-PostgreSQL integration tests for the authenticated provider
 * callback handler (T-04.2.02.02).
 *
 * Proves against actual PostgreSQL:
 *   1. A signed, in-window callback with matching merchant context
 *      credits the wallet via WalletService.credit() and leaves posted
 *      balance equal to the Completed credit (Pending intent is Released).
 *   2. Browser-unauthenticated / unsigned payloads never credit.
 *   3. Duplicate event ids do not post a second credit.
 *   4. A colliding replay of the same pending order still uses the
 *      credit idempotency key.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from '@barghsa/db/test'
import type { IsolatedTestDb } from '@barghsa/db/test'
import { ErrorCodes } from '@barghsa/shared/errors'
import { WalletService } from './wallet.service.js'
import {
  OnlineTopUpCallbackService,
  onlineTopUpCreditIdempotencyKey,
  zarinpalReturnEventId,
} from './online-topup-callback.service.js'
import { signPaymentCallback } from './payment-callback-verifier.js'
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
const CALLBACK_EVENTS_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0070_create_wallet_topup_callback_events.sql',
)
const CALLBACK_EVENTS_PROCESSING_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0071_wallet_topup_callback_events_processing_status.sql',
)

const PROFILE_A = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
const SECRET = 'integration-webhook-secret'
const MERCHANT = 'barghsa-test-merchant'
const AMOUNT = 25_000n
const AUTHORITY = 'auth-integration-1'

describe('OnlineTopUpCallbackService — real PostgreSQL (T-04.2.02.02)', () => {
  let ctx: IsolatedTestDb
  let walletService: WalletService
  let service: OnlineTopUpCallbackService
  let pendingId: string

  beforeAll(async () => {
    ctx = await createIsolatedTestDb('test_', 4)
    poolHolder.pool = ctx.pool
    walletService = new WalletService()
    const gateway: PaymentGateway = {
      async startPayment() {
        throw new Error('startPayment is not used by the callback handler')
      },
      async recoverPayment() {
        return null
      },
      async verifyPayment() {
        return { paid: true, providerRefId: 'psp-ref-int' }
      },
    }
    service = new OnlineTopUpCallbackService(walletService, gateway, {
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
    await ctx.pool.query(readFileSync(CALLBACK_EVENTS_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(CALLBACK_EVENTS_PROCESSING_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(`INSERT INTO profiles (id) VALUES ($1)`, [PROFILE_A])
    await ctx.pool.query(`INSERT INTO wallets (profile_id) VALUES ($1)`, [PROFILE_A])

    const pending = await ctx.pool.query<{ id: string }>(
      `INSERT INTO wallet_transactions
         (wallet_id, type, amount, state, idempotency_key, ref_id, description, metadata)
       VALUES ($1, 'topup', $2::bigint, 'Pending', $3, $4, $5, $6::jsonb)
       RETURNING id`,
      [
        PROFILE_A,
        AMOUNT.toString(),
        'online-topup-callback-int',
        AUTHORITY,
        'Online wallet top-up',
        JSON.stringify({
          channel: 'online',
          gateway: { authority: AUTHORITY, redirectUrl: 'https://pay.test/start' },
        }),
      ],
    )
    pendingId = pending.rows[0]!.id
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

  it('credits the wallet once from a signed callback and releases the Pending intent', async () => {
    const result = await service.handle(
      signed(
        {
          merchantOrderId: pendingId,
          merchantId: MERCHANT,
          authority: AUTHORITY,
          amountIrR: AMOUNT.toString(),
          status: 'paid',
        },
        'evt-int-1',
      ),
    )

    expect(result.credited).toBe(true)
    expect(result.creditTransactionId).toBeTruthy()

    const wallet = await fetchWallet()
    expect(wallet.posted_balance).toBe(AMOUNT.toString())
    expect(wallet.reserved_balance).toBe('0')

    const ledger = await ctx.pool.query<{
      id: string
      state: string
      idempotency_key: string
      amount: string
    }>(
      `SELECT id, state, idempotency_key, amount::text AS amount
       FROM wallet_transactions WHERE wallet_id = $1 ORDER BY created_at, id`,
      [PROFILE_A],
    )
    const pending = ledger.rows.find((row) => row.id === pendingId)
    const credit = ledger.rows.find(
      (row) => row.idempotency_key === onlineTopUpCreditIdempotencyKey(pendingId),
    )
    expect(pending?.state).toBe('Released')
    expect(credit?.state).toBe('Completed')
    expect(credit?.amount).toBe(AMOUNT.toString())
  })

  it('does not credit a second time for the same event id', async () => {
    const before = await fetchWallet()
    const result = await service.handle(
      signed(
        {
          merchantOrderId: pendingId,
          merchantId: MERCHANT,
          authority: AUTHORITY,
          amountIrR: AMOUNT.toString(),
          status: 'paid',
        },
        'evt-int-1',
      ),
    )
    expect(result.processed).toBe(false)
    expect(result.credited).toBe(true)
    const after = await fetchWallet()
    expect(after.posted_balance).toBe(before.posted_balance)

    const events = await ctx.pool.query(
      `SELECT event_id FROM wallet_topup_callback_events WHERE event_id = $1`,
      ['evt-int-1'],
    )
    expect(events.rows).toHaveLength(1)
  })

  it('does not credit a different pending order that reuses a claimed event id', async () => {
    const pending2 = await ctx.pool.query<{ id: string }>(
      `INSERT INTO wallet_transactions
         (wallet_id, type, amount, state, idempotency_key, ref_id, description, metadata)
       VALUES ($1, 'topup', $2::bigint, 'Pending', $3, $4, $5, $6::jsonb)
       RETURNING id`,
      [
        PROFILE_A,
        AMOUNT.toString(),
        'online-topup-callback-int-other',
        AUTHORITY,
        'Online wallet top-up',
        JSON.stringify({
          channel: 'online',
          gateway: { authority: AUTHORITY, redirectUrl: 'https://pay.test/start' },
        }),
      ],
    )
    const otherId = pending2.rows[0]!.id
    const before = await fetchWallet()
    const result = await service.handle(
      signed(
        {
          merchantOrderId: otherId,
          merchantId: MERCHANT,
          authority: AUTHORITY,
          amountIrR: AMOUNT.toString(),
          status: 'paid',
        },
        'evt-int-1',
      ),
    )
    expect(result.processed).toBe(false)
    expect(result.transactionId).toBe(pendingId)
    const after = await fetchWallet()
    expect(after.posted_balance).toBe(before.posted_balance)

    const extraCredit = await ctx.pool.query(
      `SELECT id FROM wallet_transactions WHERE idempotency_key = $1`,
      [onlineTopUpCreditIdempotencyKey(otherId)],
    )
    expect(extraCredit.rows).toHaveLength(0)
  })

  it('resumes credit after a crash that claimed the event id', async () => {
    const pendingCrash = await ctx.pool.query<{ id: string }>(
      `INSERT INTO wallet_transactions
         (wallet_id, type, amount, state, idempotency_key, ref_id, description, metadata)
       VALUES ($1, 'topup', $2::bigint, 'Pending', $3, $4, $5, $6::jsonb)
       RETURNING id`,
      [
        PROFILE_A,
        AMOUNT.toString(),
        'online-topup-callback-int-crash',
        AUTHORITY,
        'Online wallet top-up',
        JSON.stringify({
          channel: 'online',
          gateway: { authority: AUTHORITY, redirectUrl: 'https://pay.test/start' },
        }),
      ],
    )
    const crashPendingId = pendingCrash.rows[0]!.id
    await ctx.pool.query(
      `INSERT INTO wallet_topup_callback_events
         (event_id, pending_transaction_id, wallet_id, status, raw)
       VALUES ($1, $2, $3, 'processing', $4::jsonb)`,
      [
        'evt-int-crash',
        crashPendingId,
        PROFILE_A,
        JSON.stringify({
          merchantOrderId: crashPendingId,
          merchantId: MERCHANT,
          authority: AUTHORITY,
          amountIrR: AMOUNT.toString(),
          status: 'paid',
        }),
      ],
    )

    const before = await fetchWallet()
    const result = await service.handle(
      signed(
        {
          merchantOrderId: crashPendingId,
          merchantId: MERCHANT,
          authority: AUTHORITY,
          amountIrR: AMOUNT.toString(),
          status: 'paid',
        },
        'evt-int-crash',
      ),
    )
    expect(result.credited).toBe(true)
    expect(result.processed).toBe(true)
    const after = await fetchWallet()
    expect(BigInt(after.posted_balance)).toBe(BigInt(before.posted_balance) + AMOUNT)

    const event = await ctx.pool.query<{ status: string }>(
      `SELECT status FROM wallet_topup_callback_events WHERE event_id = $1`,
      ['evt-int-crash'],
    )
    expect(event.rows).toHaveLength(1)
    expect(event.rows[0]?.status).toBe('credited')
  })

  it('rejects a wrong signature without changing balances', async () => {
    const before = await fetchWallet()
    const rawBody = JSON.stringify({
      merchantOrderId: pendingId,
      merchantId: MERCHANT,
      authority: AUTHORITY,
      amountIrR: AMOUNT.toString(),
      status: 'paid',
    })
    const timestamp = String(Math.floor(Date.now() / 1000))
    const rejection = await service
      .handle({
        headers: {
          eventId: 'evt-bad-sig',
          timestamp,
          signature: signPaymentCallback(rawBody, 'evt-bad-sig', timestamp, 'wrong-secret'),
        },
        rawBody,
      })
      .catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(HttpException)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      error: ErrorCodes.PROVIDER_CALLBACK_INVALID.code,
    })
    const after = await fetchWallet()
    expect(after.posted_balance).toBe(before.posted_balance)
  })

  it('credits once from a ZarinPal GET return after server-side verify', async () => {
    const pendingZarinpal = await ctx.pool.query<{ id: string }>(
      `INSERT INTO wallet_transactions
         (wallet_id, type, amount, state, idempotency_key, ref_id, description, metadata)
       VALUES ($1, 'topup', $2::bigint, 'Pending', $3, $4, $5, $6::jsonb)
       RETURNING id`,
      [
        PROFILE_A,
        AMOUNT.toString(),
        'online-topup-callback-int-zarinpal',
        AUTHORITY,
        'Online wallet top-up',
        JSON.stringify({
          channel: 'online',
          gateway: { authority: AUTHORITY, redirectUrl: 'https://pay.test/start' },
        }),
      ],
    )
    const zarinpalPendingId = pendingZarinpal.rows[0]!.id
    const before = await fetchWallet()

    const result = await service.handleZarinpalReturn({
      orderId: zarinpalPendingId,
      authority: AUTHORITY,
      status: 'OK',
    })
    expect(result.credited).toBe(true)
    expect(result.processed).toBe(true)

    const after = await fetchWallet()
    expect(BigInt(after.posted_balance)).toBe(BigInt(before.posted_balance) + AMOUNT)

    const credit = await ctx.pool.query<{ state: string }>(
      `SELECT state FROM wallet_transactions WHERE idempotency_key = $1`,
      [onlineTopUpCreditIdempotencyKey(zarinpalPendingId)],
    )
    expect(credit.rows).toHaveLength(1)
    expect(credit.rows[0]?.state).toBe('Completed')

    const event = await ctx.pool.query<{ status: string }>(
      `SELECT status FROM wallet_topup_callback_events WHERE event_id = $1`,
      [zarinpalReturnEventId(zarinpalPendingId, AUTHORITY, 'paid')],
    )
    expect(event.rows).toHaveLength(1)
    expect(event.rows[0]?.status).toBe('credited')

    const replay = await service.handleZarinpalReturn({
      orderId: zarinpalPendingId,
      authority: AUTHORITY,
      status: 'OK',
    })
    expect(replay.processed).toBe(false)
    expect(replay.credited).toBe(true)
    const afterReplay = await fetchWallet()
    expect(afterReplay.posted_balance).toBe(after.posted_balance)
  })

  it('credits a ZarinPal OK return after an earlier NOK for the same order and authority', async () => {
    const pendingZarinpal = await ctx.pool.query<{ id: string }>(
      `INSERT INTO wallet_transactions
         (wallet_id, type, amount, state, idempotency_key, ref_id, description, metadata)
       VALUES ($1, 'topup', $2::bigint, 'Pending', $3, $4, $5, $6::jsonb)
       RETURNING id`,
      [
        PROFILE_A,
        AMOUNT.toString(),
        'online-topup-callback-int-zarinpal-nok-ok',
        AUTHORITY,
        'Online wallet top-up',
        JSON.stringify({
          channel: 'online',
          gateway: { authority: AUTHORITY, redirectUrl: 'https://pay.test/start' },
        }),
      ],
    )
    const zarinpalPendingId = pendingZarinpal.rows[0]!.id
    const before = await fetchWallet()

    const nok = await service.handleZarinpalReturn({
      orderId: zarinpalPendingId,
      authority: AUTHORITY,
      status: 'NOK',
    })
    expect(nok).toMatchObject({ processed: true, credited: false })

    const afterNok = await ctx.pool.query<{ state: string }>(
      `SELECT state FROM wallet_transactions WHERE id = $1`,
      [zarinpalPendingId],
    )
    expect(afterNok.rows[0]?.state).toBe('Failed')

    const unpaidEvent = await ctx.pool.query<{ status: string }>(
      `SELECT status FROM wallet_topup_callback_events WHERE event_id = $1`,
      [zarinpalReturnEventId(zarinpalPendingId, AUTHORITY, 'cancelled')],
    )
    expect(unpaidEvent.rows[0]?.status).toBe('unpaid')

    const ok = await service.handleZarinpalReturn({
      orderId: zarinpalPendingId,
      authority: AUTHORITY,
      status: 'OK',
    })
    expect(ok).toMatchObject({ processed: true, credited: true })

    const after = await fetchWallet()
    expect(BigInt(after.posted_balance)).toBe(BigInt(before.posted_balance) + AMOUNT)

    const credit = await ctx.pool.query<{ state: string }>(
      `SELECT state FROM wallet_transactions WHERE idempotency_key = $1`,
      [onlineTopUpCreditIdempotencyKey(zarinpalPendingId)],
    )
    expect(credit.rows).toHaveLength(1)
    expect(credit.rows[0]?.state).toBe('Completed')

    const paidEvent = await ctx.pool.query<{ status: string }>(
      `SELECT status FROM wallet_topup_callback_events WHERE event_id = $1`,
      [zarinpalReturnEventId(zarinpalPendingId, AUTHORITY, 'paid')],
    )
    expect(paidEvent.rows[0]?.status).toBe('credited')
  })
})
