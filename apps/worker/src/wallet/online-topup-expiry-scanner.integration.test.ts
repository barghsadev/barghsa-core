/**
 * Real-PostgreSQL integration tests for the online top-up expiry
 * scanner (T-04.2.02.07).
 *
 * Fake-pool unit tests cannot prove JSONB channel filtering, created_at
 * cutoff, or the jsonb merge that preserves gateway authority. This
 * suite applies the migrated wallet schema and runs a full
 * `expireStaleOnlineTopUps` pass against Testcontainers PostgreSQL 17.
 */

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createIsolatedTestDb, dropTestSchema } from '@barghsa/db/test'
import type { IsolatedTestDb } from '@barghsa/db/test'
import {
  DEFAULT_ONLINE_TOPUP_PENDING_TTL_MS,
  ONLINE_TOPUP_CHANNEL,
  ONLINE_TOPUP_EXPIRY_AUDIT_EVENT,
  ONLINE_TOPUP_EXPIRY_REASON,
  ONLINE_TOPUP_EXPIRY_TRANSITION,
} from '@barghsa/shared/finance'
import {
  FIND_EXPIRED_ONLINE_TOPUP_CANDIDATES_SQL,
  expireStaleOnlineTopUps,
} from './online-topup-expiry-scanner.js'

const UUIDV7_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0000_init_uuidv7_function.sql',
)
const WALLET_TX_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0068_create_wallet_transactions.sql',
)
const AUDIT_LOG_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0005_create_audit_log.sql',
)
const EXPIRY_IDX_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0076_wallet_tx_online_pending_expiry_idx.sql',
)

const WALLET_A = '11111111-1111-7111-8111-111111111111'
const WALLET_B = '22222222-2222-7222-8222-222222222222'
const ACTOR_USER_ID = 'online-expiry-scanner-actor'
const NOW = new Date('2026-09-02T12:00:00.000Z')
const TTL = DEFAULT_ONLINE_TOPUP_PENDING_TTL_MS
const CUTOFF = new Date(NOW.getTime() - TTL)
const EXPIRED_EARLY = new Date(CUTOFF.getTime() - 120_000)
const EXPIRED_LATE = new Date(CUTOFF.getTime() - 30_000)
const FRESH = new Date(NOW.getTime() - 60_000)

describe('online top-up expiry — real PostgreSQL (T-04.2.02.07)', () => {
  let ctx: IsolatedTestDb

  beforeAll(async () => {
    ctx = await createIsolatedTestDb('test_', 2)

    await ctx.pool.query(readFileSync(UUIDV7_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(`CREATE TABLE IF NOT EXISTS profiles (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
    )`)
    await ctx.pool.query(`CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY
    )`)
    await ctx.pool.query(readFileSync(WALLET_TX_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(EXPIRY_IDX_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(AUDIT_LOG_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(`INSERT INTO profiles (id) VALUES ($1), ($2)`, [WALLET_A, WALLET_B])
    await ctx.pool.query(
      `INSERT INTO wallets (profile_id, posted_balance, reserved_balance, version)
       VALUES ($1, 0, 0, 0), ($2, 0, 0, 0)`,
      [WALLET_A, WALLET_B],
    )
    await ctx.pool.query(
      `INSERT INTO users (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
      [ACTOR_USER_ID],
    )
  }, 60_000)

  afterAll(async () => {
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  beforeEach(async () => {
    await ctx.pool.query('DELETE FROM audit_log')
    await ctx.pool.query('DELETE FROM wallet_transactions')
  })

  async function insertTopUp(opts: {
    walletId?: string
    state: string
    channel: string
    createdAt: Date
    authority?: string
    amount?: number
  }): Promise<string> {
    const id = randomUUID()
    await ctx.pool.query(
      `INSERT INTO wallet_transactions
         (id, wallet_id, type, amount, state, idempotency_key, metadata, created_at)
       VALUES ($1, $2, 'topup', $3::bigint, $4, $5, $6::jsonb, $7)`,
      [
        id,
        opts.walletId ?? WALLET_A,
        opts.amount ?? 75_000,
        opts.state,
        `idem-${id}`,
        JSON.stringify({
          channel: opts.channel,
          ...(opts.authority
            ? { gateway: { authority: opts.authority, redirectUrl: 'https://pay.test' } }
            : {}),
        }),
        opts.createdAt,
      ],
    )
    return id
  }

  it('candidate query returns only online Pending rows older than the cutoff', async () => {
    const expiredEarly = await insertTopUp({
      state: 'Pending',
      channel: ONLINE_TOPUP_CHANNEL,
      createdAt: EXPIRED_EARLY,
      authority: 'auth-early',
    })
    const expiredLate = await insertTopUp({
      walletId: WALLET_B,
      state: 'Pending',
      channel: ONLINE_TOPUP_CHANNEL,
      createdAt: EXPIRED_LATE,
      authority: 'auth-late',
    })
    const fresh = await insertTopUp({
      state: 'Pending',
      channel: ONLINE_TOPUP_CHANNEL,
      createdAt: FRESH,
      authority: 'auth-fresh',
    })
    const bankReceipt = await insertTopUp({
      state: 'Pending',
      channel: 'bank_receipt',
      createdAt: EXPIRED_EARLY,
    })
    const alreadyRejected = await insertTopUp({
      state: 'Rejected',
      channel: ONLINE_TOPUP_CHANNEL,
      createdAt: EXPIRED_EARLY,
      authority: 'auth-rejected',
    })
    const failed = await insertTopUp({
      state: 'Failed',
      channel: ONLINE_TOPUP_CHANNEL,
      createdAt: EXPIRED_EARLY,
      authority: 'auth-failed',
    })

    const result = await ctx.pool.query<{ id: string }>(FIND_EXPIRED_ONLINE_TOPUP_CANDIDATES_SQL, [
      ONLINE_TOPUP_CHANNEL,
      CUTOFF,
      200,
    ])

    expect(result.rows.map((row) => row.id)).toEqual([expiredEarly, expiredLate])
    expect(result.rows.some((row) => row.id === fresh)).toBe(false)
    expect(result.rows.some((row) => row.id === bankReceipt)).toBe(false)
    expect(result.rows.some((row) => row.id === alreadyRejected)).toBe(false)
    expect(result.rows.some((row) => row.id === failed)).toBe(false)
  })

  it('honours LIMIT and oldest-created ordering on the migrated schema', async () => {
    const first = await insertTopUp({
      state: 'Pending',
      channel: ONLINE_TOPUP_CHANNEL,
      createdAt: EXPIRED_EARLY,
    })
    await insertTopUp({
      state: 'Pending',
      channel: ONLINE_TOPUP_CHANNEL,
      createdAt: EXPIRED_LATE,
    })

    const result = await ctx.pool.query<{ id: string }>(FIND_EXPIRED_ONLINE_TOPUP_CANDIDATES_SQL, [
      ONLINE_TOPUP_CHANNEL,
      CUTOFF,
      1,
    ])

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.id).toBe(first)
  })

  it('does not treat created_at equal to the cutoff as expired (exclusive TTL)', async () => {
    const onCutoff = await insertTopUp({
      state: 'Pending',
      channel: ONLINE_TOPUP_CHANNEL,
      createdAt: CUTOFF,
      authority: 'auth-boundary',
    })
    const result = await ctx.pool.query<{ id: string }>(FIND_EXPIRED_ONLINE_TOPUP_CANDIDATES_SQL, [
      ONLINE_TOPUP_CHANNEL,
      CUTOFF,
      200,
    ])
    expect(result.rows.some((row) => row.id === onCutoff)).toBe(false)
  })

  it('rejects expired online Pendings, preserves gateway authority, and leaves balances and bank receipts untouched', async () => {
    const expiredId = await insertTopUp({
      state: 'Pending',
      channel: ONLINE_TOPUP_CHANNEL,
      createdAt: EXPIRED_EARLY,
      authority: 'auth-keep',
    })
    const freshId = await insertTopUp({
      state: 'Pending',
      channel: ONLINE_TOPUP_CHANNEL,
      createdAt: FRESH,
      authority: 'auth-fresh',
    })
    const bankId = await insertTopUp({
      state: 'Pending',
      channel: 'bank_receipt',
      createdAt: EXPIRED_EARLY,
    })

    const scan = await expireStaleOnlineTopUps({
      pool: ctx.pool,
      now: () => NOW,
      ttlMs: TTL,
      batchSize: 50,
      actorUserId: ACTOR_USER_ID,
      correlationId: 'corr-online-expiry-pg',
    })

    expect(scan.errors).toEqual([])
    expect(scan).toMatchObject({ scanned: 1, rejected: 1, skipped: 0 })

    const expired = await ctx.pool.query<{
      state: string
      metadata: {
        channel?: string
        gateway?: { authority?: string }
        expiry?: { reason?: string; ttlMs?: number; rejectedAt?: string }
      }
    }>(`SELECT state, metadata FROM wallet_transactions WHERE id = $1`, [expiredId])
    expect(expired.rows[0]?.state).toBe('Rejected')
    expect(expired.rows[0]?.metadata.channel).toBe(ONLINE_TOPUP_CHANNEL)
    expect(expired.rows[0]?.metadata.gateway?.authority).toBe('auth-keep')
    expect(expired.rows[0]?.metadata.expiry).toMatchObject({
      reason: ONLINE_TOPUP_EXPIRY_REASON,
      ttlMs: TTL,
      rejectedAt: NOW.toISOString(),
    })

    const fresh = await ctx.pool.query<{ state: string }>(
      `SELECT state FROM wallet_transactions WHERE id = $1`,
      [freshId],
    )
    expect(fresh.rows[0]?.state).toBe('Pending')

    const bank = await ctx.pool.query<{ state: string }>(
      `SELECT state FROM wallet_transactions WHERE id = $1`,
      [bankId],
    )
    expect(bank.rows[0]?.state).toBe('Pending')

    const wallet = await ctx.pool.query<{ posted_balance: string; reserved_balance: string }>(
      `SELECT posted_balance, reserved_balance FROM wallets WHERE profile_id = $1`,
      [WALLET_A],
    )
    expect(wallet.rows[0]).toMatchObject({ posted_balance: '0', reserved_balance: '0' })

    const audit = await ctx.pool.query<{ event: string; metadata: string }>(
      `SELECT event, metadata FROM audit_log WHERE metadata LIKE $1`,
      [`%${expiredId}%`],
    )
    expect(audit.rows[0]?.event).toBe(ONLINE_TOPUP_EXPIRY_AUDIT_EVENT)
    expect(JSON.parse(audit.rows[0]!.metadata)).toMatchObject({
      transactionId: expiredId,
      walletId: WALLET_A,
      fromState: 'Pending',
      toState: 'Rejected',
      transition: ONLINE_TOPUP_EXPIRY_TRANSITION,
      reason: ONLINE_TOPUP_EXPIRY_REASON,
      ttlMs: TTL,
    })
  })

  it('is idempotent: a second pass does not re-reject or change metadata', async () => {
    const expiredId = await insertTopUp({
      state: 'Pending',
      channel: ONLINE_TOPUP_CHANNEL,
      createdAt: EXPIRED_EARLY,
      authority: 'auth-once',
    })

    const first = await expireStaleOnlineTopUps({
      pool: ctx.pool,
      now: () => NOW,
      ttlMs: TTL,
      actorUserId: ACTOR_USER_ID,
    })
    expect(first.rejected).toBe(1)

    const second = await expireStaleOnlineTopUps({
      pool: ctx.pool,
      now: () => NOW,
      ttlMs: TTL,
      actorUserId: ACTOR_USER_ID,
    })
    expect(second).toMatchObject({ scanned: 0, rejected: 0, skipped: 0, errors: [] })

    const row = await ctx.pool.query<{ state: string }>(
      `SELECT state FROM wallet_transactions WHERE id = $1`,
      [expiredId],
    )
    expect(row.rows[0]?.state).toBe('Rejected')

    const audits = await ctx.pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM audit_log WHERE event = $1`,
      [ONLINE_TOPUP_EXPIRY_AUDIT_EVENT],
    )
    expect(audits.rows[0]?.n).toBe('1')
  })
})
