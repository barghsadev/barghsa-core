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
const REMINDER_IDEMPOTENCY_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0061_add_invoice_reminder_schedule_idempotency.sql',
)
const REMINDER_OFFSET_TOGGLES_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0062_create_invoice_reminder_offset_toggles.sql',
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
    await ctx.pool.query(readFileSync(REMINDER_IDEMPOTENCY_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(REMINDER_OFFSET_TOGGLES_MIGRATION, 'utf-8').trim())

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
    await ctx.pool.query('DELETE FROM invoice_reminder_offset_toggles')
    await ctx.pool.query('DELETE FROM invoices')
  })

  async function insertInvoice(opts: {
    state: string
    dueAt: Date | null
    issuedAt: Date | null
    paidAmount?: number
    metadata?: Record<string, unknown>
  }): Promise<string> {
    const id = randomUUID()
    const paid = opts.paidAmount ?? (opts.state === 'PartiallyFunded' ? 400_000 : 0)
    await ctx.pool.query(
      `INSERT INTO invoices
         (id, profile_id, state, total_amount, paid_amount, issued_at, due_at, metadata)
       VALUES ($1, $2, $3::invoice_state, 1000000, $4, $5, $6, $7::jsonb)`,
      [
        id,
        PROFILE_ID,
        opts.state,
        paid,
        opts.issuedAt,
        opts.dueAt,
        opts.metadata ? JSON.stringify(opts.metadata) : null,
      ],
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
      [[...REMINDER_STOP_STATES], 200, ISSUED, null, null],
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
      now: ISSUED,
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
      now: ISSUED,
    })
    expect(second).toMatchObject({ scanned: 0, scheduled: 0, skipped: 0, errors: [] })

    const count = await ctx.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM invoice_reminder_schedule WHERE invoice_id = $1`,
      [invoiceId],
    )
    expect(count.rows[0]?.count).toBe('6')
  })

  it('omits admin-disabled offsets for the invoice service type (T-04.1.04.05)', async () => {
    await ctx.pool.query(
      `INSERT INTO invoice_reminder_offset_toggles (service_type, "offset", enabled, updated_by)
       VALUES ('electricity', -7, FALSE, $1), ('electricity', 7, FALSE, $1)`,
      [USER_ID],
    )
    const invoiceId = await insertInvoice({
      state: 'Unpaid',
      dueAt: DUE,
      issuedAt: ISSUED,
      metadata: { due: { serviceType: 'electricity' } },
    })

    const result = await scheduleIssuedInvoiceReminders({
      pool: ctx.pool,
      deliveryWindow: DEFAULT_DELIVERY_WINDOW,
      batchSize: 50,
      now: ISSUED,
    })
    expect(result).toMatchObject({ scanned: 1, scheduled: 1, skipped: 0, errors: [] })

    const rows = await ctx.pool.query<{ offset: number }>(
      `SELECT "offset" FROM invoice_reminder_schedule WHERE invoice_id = $1 ORDER BY "offset" ASC`,
      [invoiceId],
    )
    expect(rows.rows.map((row) => row.offset)).toEqual([-3, -1, 0, 1])
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

  it('does not queue elapsed offsets for a short due period or a delayed catch-up pass', async () => {
    const shortIssued = new Date('2026-09-05T12:00:00.000Z')
    const shortId = await insertInvoice({
      state: 'Unpaid',
      dueAt: DUE,
      issuedAt: shortIssued,
    })
    const short = await scheduleIssuedInvoiceReminders({
      pool: ctx.pool,
      deliveryWindow: DEFAULT_DELIVERY_WINDOW,
      now: shortIssued,
    })
    expect(short).toMatchObject({ scanned: 1, scheduled: 1, errors: [] })
    const shortRows = await ctx.pool.query<{ offset: number }>(
      `SELECT "offset" FROM invoice_reminder_schedule WHERE invoice_id = $1 ORDER BY "offset" ASC`,
      [shortId],
    )
    expect(shortRows.rows.map((row) => row.offset)).toEqual([-1, 0, 1, 7])

    await ctx.pool.query('DELETE FROM invoice_reminder_schedule')
    await ctx.pool.query('DELETE FROM invoices')

    const lateId = await insertInvoice({
      state: 'Unpaid',
      dueAt: DUE,
      issuedAt: ISSUED,
    })
    const lateNow = new Date('2026-09-05T12:00:00.000Z')
    const late = await scheduleIssuedInvoiceReminders({
      pool: ctx.pool,
      deliveryWindow: DEFAULT_DELIVERY_WINDOW,
      now: lateNow,
    })
    expect(late).toMatchObject({ scanned: 1, scheduled: 1, errors: [] })
    const lateRows = await ctx.pool.query<{ offset: number; scheduled_at: Date }>(
      `SELECT "offset", scheduled_at
         FROM invoice_reminder_schedule
        WHERE invoice_id = $1
        ORDER BY "offset" ASC`,
      [lateId],
    )
    expect(lateRows.rows.map((row) => row.offset)).toEqual([-1, 0, 1, 7])
    expect(
      lateRows.rows.every((row) => row.scheduled_at.getTime() >= lateNow.getTime()),
    ).toBe(true)
  })

  it('excludes invoices whose latest reminder is already outside the catch-up window', async () => {
    const staleId = await insertInvoice({
      state: 'Unpaid',
      dueAt: new Date('2026-01-01T12:00:00.000Z'),
      issuedAt: new Date('2025-12-25T12:00:00.000Z'),
    })
    const freshId = await insertInvoice({
      state: 'Unpaid',
      dueAt: DUE,
      issuedAt: ISSUED,
    })

    const result = await ctx.pool.query<{ id: string }>(FIND_UNSCHEDULED_ISSUED_INVOICES_SQL, [
      [...REMINDER_STOP_STATES],
      200,
      ISSUED,
      null,
      null,
    ])

    expect(result.rows.map((row) => row.id)).toEqual([freshId])
    expect(result.rows.some((row) => row.id === staleId)).toBe(false)
  })

  it('schedules a newly issued invoice when a full batch of terminally stale invoices is older', async () => {
    const batchSize = 8
    const staleIssued = new Date('2025-12-25T12:00:00.000Z')
    for (let index = 0; index < batchSize; index += 1) {
      await insertInvoice({
        state: 'Unpaid',
        dueAt: new Date('2026-01-01T12:00:00.000Z'),
        issuedAt: new Date(staleIssued.getTime() + index * 1000),
      })
    }
    const freshId = await insertInvoice({
      state: 'Unpaid',
      dueAt: DUE,
      issuedAt: ISSUED,
    })

    const pass = await scheduleIssuedInvoiceReminders({
      pool: ctx.pool,
      deliveryWindow: DEFAULT_DELIVERY_WINDOW,
      batchSize,
      now: ISSUED,
    })

    expect(pass.errors).toEqual([])
    expect(pass.scheduled).toBe(1)
    expect(pass.scanned).toBe(1)
    const scheduled = await ctx.pool.query<{ invoice_id: string }>(
      `SELECT DISTINCT invoice_id FROM invoice_reminder_schedule`,
    )
    expect(scheduled.rows.map((row) => row.invoice_id)).toEqual([freshId])
  })

  it('schedules a newly issued invoice after a full batch of elapsed-offset invoices', async () => {
    const batchSize = 8
    const staleDue = new Date('2026-09-07T12:00:00.000Z')
    const staleIssued = new Date('2026-08-31T12:00:00.000Z')
    // +7 is 2h before `now`, inside the daytime window, so the planner
    // emits no rows; due+8 days is still after the cutoff so SQL keeps them.
    const now = new Date('2026-09-14T14:00:00.000Z')
    const staleIds: string[] = []
    for (let index = 0; index < batchSize; index += 1) {
      staleIds.push(
        await insertInvoice({
          state: 'Unpaid',
          dueAt: staleDue,
          issuedAt: new Date(staleIssued.getTime() + index * 1000),
        }),
      )
    }
    const freshIssued = new Date('2026-09-14T13:30:00.000Z')
    const freshDue = new Date('2026-09-21T12:00:00.000Z')
    const freshId = await insertInvoice({
      state: 'Unpaid',
      dueAt: freshDue,
      issuedAt: freshIssued,
    })

    const pass = await scheduleIssuedInvoiceReminders({
      pool: ctx.pool,
      deliveryWindow: DEFAULT_DELIVERY_WINDOW,
      batchSize,
      now,
    })

    expect(pass.errors).toEqual([])
    expect(pass.scheduled).toBe(1)
    expect(pass.scanned).toBeGreaterThan(batchSize)

    const scheduled = await ctx.pool.query<{ invoice_id: string }>(
      `SELECT DISTINCT invoice_id FROM invoice_reminder_schedule`,
    )
    expect(scheduled.rows.map((row) => row.invoice_id)).toEqual([freshId])
    expect(staleIds.every((id) => scheduled.rows.every((row) => row.invoice_id !== id))).toBe(
      true,
    )
  })
})
