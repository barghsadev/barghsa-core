/**
 * Real-PostgreSQL integration tests for finance chargeback alerts
 * (T-04.2.04.03 / S-04.2.04).
 *
 * Proves against actual PostgreSQL:
 *   1. An unmatched chargeback enqueues immediate in-app + email jobs
 *      for finance-role staff (and platform admins).
 *   2. The outbox payload carries the admin-dashboard deep-link.
 *   3. A duplicate alert reuses the idempotency key and still has jobs.
 *   4. The dashboard warning lists unmatched / reversal-failed rows and
 *      hides reversed events.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from '@barghsa/db/test'
import type { IsolatedTestDb } from '@barghsa/db/test'
import { WALLET_CHARGEBACK_REASON } from '@barghsa/shared/finance'
import {
  ChargebackAlertService,
  enqueueFinanceChargebackAlert,
} from './chargeback-alert.service.js'

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
const OUTBOX_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0025_create_notification_outbox.sql',
)

const FINANCE_USER = 'staff-finance-1'
const ADMIN_USER = 'staff-admin-1'
const OTHER_USER = 'staff-ops-1'
const FINANCE_PROFILE = '11111111-1111-7111-8111-111111111111'
const ADMIN_PROFILE = '22222222-2222-7222-8222-222222222222'
const OTHER_PROFILE = '33333333-3333-7333-8333-333333333333'
const EVENT_ID = 'evt-cb-alert-int-1'

describe('ChargebackAlertService — real PostgreSQL (T-04.2.04.03)', () => {
  let ctx: IsolatedTestDb
  const service = new ChargebackAlertService()

  beforeAll(async () => {
    ctx = await createIsolatedTestDb('test_', 2)
    poolHolder.pool = ctx.pool

    await ctx.pool.query(readFileSync(UUIDV7_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        is_admin BOOLEAN NOT NULL DEFAULT false
      )
    `)
    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
        user_id TEXT NOT NULL REFERENCES users(user_id),
        is_default BOOLEAN NOT NULL DEFAULT false
      )
    `)
    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS user_roles (
        user_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        PRIMARY KEY (user_id, role_id)
      )
    `)
    await ctx.pool.query(readFileSync(OUTBOX_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS wallet_chargeback_events (
        event_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        wallet_id UUID,
        original_transaction_id UUID,
        raw JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await ctx.pool.query(
      `INSERT INTO users (user_id, is_admin) VALUES ($1, false), ($2, true), ($3, false)`,
      [FINANCE_USER, ADMIN_USER, OTHER_USER],
    )
    await ctx.pool.query(
      `INSERT INTO profiles (id, user_id, is_default) VALUES ($1, $2, true), ($3, $4, true), ($5, $6, true)`,
      [FINANCE_PROFILE, FINANCE_USER, ADMIN_PROFILE, ADMIN_USER, OTHER_PROFILE, OTHER_USER],
    )
    await ctx.pool.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, 'role-finance')`, [
      FINANCE_USER,
    ])
  }, 60_000)

  afterAll(async () => {
    poolHolder.pool = null
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  beforeEach(async () => {
    await ctx.pool.query('DELETE FROM notification_job')
    await ctx.pool.query('DELETE FROM notification_outbox')
    await ctx.pool.query('DELETE FROM wallet_chargeback_events')
  })

  function notification() {
    return {
      type: 'chargeback' as const,
      merchantId: 'm-1',
      merchantOrderId: null,
      providerRefId: 'psp-1',
      authority: null,
      amountIrR: 75_000n,
      reason: WALLET_CHARGEBACK_REASON,
    }
  }

  it('enqueues urgent in-app + email jobs for finance staff and admins', async () => {
    const client = await ctx.pool.connect()
    try {
      const result = await service.notifyUnresolved(client, {
        eventId: EVENT_ID,
        status: 'unmatched',
        notification: notification(),
        walletId: null,
        originalTransactionId: null,
      })
      expect(result).toEqual({ recipients: 2, inserted: 2 })
    } finally {
      client.release()
    }

    const outbox = await ctx.pool.query(
      `SELECT profile_id, user_id, event_key, channels, status, payload, idempotency_key
         FROM notification_outbox
        ORDER BY profile_id`,
    )
    expect(outbox.rows).toHaveLength(2)
    expect(outbox.rows.map((row) => row.profile_id).sort()).toEqual(
      [ADMIN_PROFILE, FINANCE_PROFILE].sort(),
    )
    expect(outbox.rows.every((row) => row.user_id !== OTHER_USER)).toBe(true)
    expect(outbox.rows[0]).toMatchObject({
      event_key: 'finance.chargeback_unresolved',
      status: 'queued',
    })
    expect(outbox.rows[0]?.channels).toEqual(['in_app', 'email'])
    expect(outbox.rows[0]?.payload).toMatchObject({
      event_id: EVENT_ID,
      status: 'unmatched',
      amount_irr: '75000',
      link_route: '/admin',
    })

    const jobs = await ctx.pool.query(
      `SELECT j.channel, j.status, j.priority
         FROM notification_job j
         JOIN notification_outbox o ON o.id = j.outbox_id
        WHERE o.profile_id = $1
        ORDER BY j.channel`,
      [FINANCE_PROFILE],
    )
    expect(jobs.rows).toEqual([
      { channel: 'email', status: 'queued', priority: 'urgent' },
      { channel: 'in_app', status: 'queued', priority: 'urgent' },
    ])
  })

  it('reuses the outbox row and keeps jobs when the same event is alerted twice', async () => {
    const client = await ctx.pool.connect()
    try {
      const first = await enqueueFinanceChargebackAlert(client, {
        profileId: FINANCE_PROFILE,
        userId: FINANCE_USER,
        eventId: EVENT_ID,
        payload: { event_id: EVENT_ID, link_route: '/admin' },
      })
      expect(first.inserted).toBe(true)
      const retry = await enqueueFinanceChargebackAlert(client, {
        profileId: FINANCE_PROFILE,
        userId: FINANCE_USER,
        eventId: EVENT_ID,
        payload: { event_id: EVENT_ID, link_route: '/admin' },
      })
      expect(retry).toEqual({ outboxId: first.outboxId, inserted: false })
    } finally {
      client.release()
    }

    const outbox = await ctx.pool.query(`SELECT id FROM notification_outbox`)
    expect(outbox.rows).toHaveLength(1)
    const jobs = await ctx.pool.query(`SELECT channel FROM notification_job ORDER BY channel`)
    expect(jobs.rows.map((row) => row.channel)).toEqual(['email', 'in_app'])
  })

  it('surfaces unmatched and reversal-failed rows on the dashboard warning', async () => {
    await ctx.pool.query(
      `INSERT INTO wallet_chargeback_events (event_id, status, raw, created_at)
       VALUES
         ('evt-unmatched', 'unmatched', '{"amountIrR":"75000","reason":"provider chargeback"}', '2026-09-02T06:00:00Z'),
         ('evt-failed', 'unresolved', '{"amountIrR":"10000","reason":"provider chargeback"}', '2026-09-02T05:00:00Z'),
         ('evt-reversed', 'reversed', '{"amountIrR":"5000"}', '2026-09-02T04:00:00Z')`,
    )

    const warning = await service.getDashboardWarning()
    expect(warning.count).toBe(2)
    expect(warning.unmatchedCount).toBe(1)
    expect(warning.reversalFailedCount).toBe(1)
    expect(warning.items.map((item) => item.eventId)).toEqual(['evt-unmatched', 'evt-failed'])
    expect(warning.items[0]).toMatchObject({
      status: 'unmatched',
      amountIrR: '75000',
      reason: 'provider chargeback',
    })
  })
})
