/**
 * Real-PostgreSQL integration tests for the ReminderScheduler candidate
 * query and insert (T-04.1.04.02).
 *
 * Fake-pool unit tests cannot see operator mismatches against
 * `invoice_state` or CHECK failures on offset/channel. This suite applies
 * the migrated invoice + reminder-schedule schema and runs the production
 * SQL against Testcontainers PostgreSQL 17.
 */

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createIsolatedTestDb, dropTestSchema } from '@barghsa/db/test'
import type { IsolatedTestDb } from '@barghsa/db/test'
import { INVOICE_REMINDER_OFFSETS, REMINDER_STOP_STATES } from '@barghsa/shared/finance'
import { DEFAULT_DELIVERY_WINDOW } from '@barghsa/shared/notifications'
import {
  FIND_UNSCHEDULED_ISSUED_INVOICES_SQL,
  scheduleIssuedInvoiceReminders,
} from './reminder-scheduler.js'

const UUIDV7_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0000_init_uuidv7_function.sql',
)
const INVOICES_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0052_add_invoice_amount_check_constraints.sql',
)
const REMINDER_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0060_create_invoice_reminder_schedule.sql',
)

const USER_ID = 'reminder-scheduler-owner'
const PROFILE_ID = '11111111-1111-7111-8111-111111111111'
const DUE = new Date('2026-09-07T12:00:00.000Z')
const ISSUED = new Date('2026-08-31T12:00:00.000Z')

const BROKEN_TEXT_ARRAY_SQL = `SELECT i.id
        FROM invoices i
        WHERE NOT (i.state = ANY($1::text[]))
        LIMIT 1`

describe('reminder scheduler — real PostgreSQL (T-04.1.04.02)', () => {
  let ctx: IsolatedTestDb

  beforeAll(async () => {
    ctx = await createIsolatedTestDb('test_', 2)

    await ctx.pool.query(readFileSync(UUIDV7_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(`CREATE TYPE invoice_state AS ENUM (
      'Draft', 'Unpaid', 'PaymentUnderReview', 'PartiallyFunded', 'Paid',
      'Overdue', 'Cancelled', 'PartiallyRefunded', 'Refunded'
    )`)
    await ctx.pool.query(`CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      timezone TEXT NOT NULL DEFAULT 'Asia/Tehran',
      notification_preferences TEXT NOT NULL DEFAULT 'IN_APP'
    )`)
    await ctx.pool.query(`CREATE TABLE IF NOT EXISTS profiles (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
      user_id TEXT NOT NULL REFERENCES users(user_id)
    )`)
    await ctx.pool.query(`CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
    )`)
    await ctx.pool.query(readFileSync(INVOICES_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(REMINDER_MIGRATION, 'utf-8').trim())

    await ctx.pool.query(
      `INSERT INTO users (user_id, timezone, notification_preferences)
       VALUES ($1, 'Asia/Tehran', 'IN_APP')
       ON CONFLICT (user_id) DO NOTHING`,
      [USER_ID],
    )
    await ctx.pool.query(
      `INSERT INTO profiles (id, user_id) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      [PROFILE_ID, USER_ID],
    )
  }, 60_000)

  afterAll(async () => {
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  beforeEach(async () => {
    await ctx.pool.query('DELETE FROM invoice_reminder_schedule')
    await ctx.pool.query('DELETE FROM invoices')
  })

  async function insertInvoice(opts: {
    state: string
    dueAt: Date | null
    issuedAt: Date | null
    paidAmount?: number
  }): Promise<string> {
    const id = randomUUID()
    const paid = opts.paidAmount ?? (opts.state === 'PartiallyFunded' ? 400_000 : 0)
    await ctx.pool.query(
      `INSERT INTO invoices
         (id, profile_id, state, total_amount, paid_amount, issued_at, due_at)
       VALUES ($1, $2, $3::invoice_state, 1000000, $4, $5, $6)`,
      [id, PROFILE_ID, opts.state, paid, opts.issuedAt, opts.dueAt],
    )
    return id
  }

  it('rejects text[] comparison against invoice_state (the production failure)', async () => {
    await expect(
      ctx.pool.query(BROKEN_TEXT_ARRAY_SQL, [[...REMINDER_STOP_STATES]]),
    ).rejects.toMatchObject({
      code: '42883',
    })
  })

  it('runs the candidate query against invoice_state and returns only unscheduled issued invoices', async () => {
    const unpaid = await insertInvoice({
      state: 'Unpaid',
      dueAt: DUE,
      issuedAt: ISSUED,
    })
    const overdue = await insertInvoice({
      state: 'Overdue',
      dueAt: DUE,
      issuedAt: ISSUED,
    })
    await insertInvoice({ state: 'Draft', dueAt: DUE, issuedAt: null })
    await insertInvoice({
      state: 'Paid',
      dueAt: DUE,
      issuedAt: ISSUED,
      paidAmount: 1_000_000,
    })
    await insertInvoice({ state: 'Cancelled', dueAt: DUE, issuedAt: ISSUED })
    await insertInvoice({ state: 'Unpaid', dueAt: null, issuedAt: ISSUED })

    const already = await insertInvoice({
      state: 'Unpaid',
      dueAt: DUE,
      issuedAt: ISSUED,
    })
    await ctx.pool.query(
      `INSERT INTO invoice_reminder_schedule (invoice_id, "offset", channel, scheduled_at)
       VALUES ($1, -7, 'in_app', $2)`,
      [already, DUE],
    )

    const result = await ctx.pool.query<{ id: string; state: string }>(
      FIND_UNSCHEDULED_ISSUED_INVOICES_SQL,
      [[...REMINDER_STOP_STATES], 200],
    )

    expect(result.rows.map((row) => row.id).sort()).toEqual([overdue, unpaid].sort())
    expect(result.rows.some((row) => row.id === already)).toBe(false)
  })

  it('inserts six in_app schedule rows on a real issued invoice and is idempotent', async () => {
    const invoiceId = await insertInvoice({
      state: 'Unpaid',
      dueAt: DUE,
      issuedAt: ISSUED,
    })

    const first = await scheduleIssuedInvoiceReminders({
      pool: ctx.pool,
      deliveryWindow: DEFAULT_DELIVERY_WINDOW,
      batchSize: 50,
    })
    expect(first.errors).toEqual([])
    expect(first).toMatchObject({ scanned: 1, scheduled: 1, skipped: 0 })

    const rows = await ctx.pool.query<{
      offset: number
      channel: string
      status: string
      scheduled_at: Date
    }>(
      `SELECT "offset", channel, status, scheduled_at
         FROM invoice_reminder_schedule
        WHERE invoice_id = $1
        ORDER BY "offset" ASC, channel ASC`,
      [invoiceId],
    )
    expect(rows.rows).toHaveLength(6)
    expect(rows.rows.map((row) => row.offset)).toEqual([...INVOICE_REMINDER_OFFSETS])
    expect(rows.rows.every((row) => row.channel === 'in_app')).toBe(true)
    expect(rows.rows.every((row) => row.status === 'scheduled')).toBe(true)
    const dueRow = rows.rows.find((row) => row.offset === 0)
    expect(dueRow?.scheduled_at.toISOString()).toBe(DUE.toISOString())

    const second = await scheduleIssuedInvoiceReminders({
      pool: ctx.pool,
      deliveryWindow: DEFAULT_DELIVERY_WINDOW,
      batchSize: 50,
    })
    expect(second).toMatchObject({ scanned: 0, scheduled: 0, skipped: 0, errors: [] })

    const count = await ctx.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM invoice_reminder_schedule WHERE invoice_id = $1`,
      [invoiceId],
    )
    expect(count.rows[0]?.count).toBe('6')
  })

  it('does not schedule Paid invoices even when they have issuedAt/dueAt', async () => {
    await insertInvoice({
      state: 'Paid',
      dueAt: DUE,
      issuedAt: ISSUED,
      paidAmount: 1_000_000,
    })
    const scan = await scheduleIssuedInvoiceReminders({
      pool: ctx.pool,
      deliveryWindow: DEFAULT_DELIVERY_WINDOW,
    })
    expect(scan.scanned).toBe(0)
    expect(scan.scheduled).toBe(0)
    const count = await ctx.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM invoice_reminder_schedule`,
    )
    expect(count.rows[0]?.count).toBe('0')
  })
})
