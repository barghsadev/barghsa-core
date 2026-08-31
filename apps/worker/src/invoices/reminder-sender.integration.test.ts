/**
 * Real-PostgreSQL integration tests for the ReminderSender candidate
 * query, invoice-state gate, and outbox write (T-04.1.04.03).
 *
 * Fake-pool unit tests cannot see `invoice_state` operator mismatches or
 * the notification_outbox UNIQUE idempotency constraint. This suite
 * applies the migrated invoice + reminder-schedule + outbox schema and
 * runs the production SQL against Testcontainers PostgreSQL 17.
 */

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createIsolatedTestDb, dropTestSchema } from '@barghsa/db/test'
import type { IsolatedTestDb } from '@barghsa/db/test'
import { REMINDER_STOP_STATES } from '@barghsa/shared/finance'
import {
  FIND_DUE_REMINDER_GROUPS_SQL,
  PAYMENT_INVOICE_REMINDER_EVENT_KEY,
  reminderOutboxIdempotencyKey,
  sendDueInvoiceReminders,
} from './reminder-sender.js'

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
const OUTBOX_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0025_create_notification_outbox.sql',
)

const USER_ID = 'reminder-sender-owner'
const PROFILE_ID = '11111111-1111-7111-8111-111111111111'
const DUE = new Date('2026-09-07T12:00:00.000Z')
const ISSUED = new Date('2026-08-24T12:00:00.000Z')
const NOW = new Date('2026-08-31T12:00:00.000Z')
const DUE_SCHEDULED = new Date('2026-08-31T09:00:00.000Z')
const FUTURE_SCHEDULED = new Date('2026-09-04T09:00:00.000Z')

const BROKEN_TEXT_ARRAY_SQL = `SELECT s.invoice_id
        FROM invoice_reminder_schedule s
        JOIN invoices i ON i.id = s.invoice_id
        WHERE NOT (i.state = ANY($1::text[]))
        LIMIT 1`

describe('reminder sender — real PostgreSQL (T-04.1.04.03)', () => {
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
    await ctx.pool.query(readFileSync(OUTBOX_MIGRATION, 'utf-8').trim())

    await ctx.pool.query(
      `INSERT INTO users (user_id, timezone, notification_preferences)
       VALUES ($1, 'Asia/Tehran', 'IN_APP,EMAIL')
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
    await ctx.pool.query('DELETE FROM notification_job')
    await ctx.pool.query('DELETE FROM notification_outbox')
    await ctx.pool.query('DELETE FROM invoice_reminder_schedule')
    await ctx.pool.query('DELETE FROM invoices')
  })

  async function insertInvoice(opts: {
    state: string
    dueAt?: Date | null
    paidAmount?: number
  }): Promise<string> {
    const id = randomUUID()
    const paid = opts.paidAmount ?? (opts.state === 'PartiallyFunded' ? 400_000 : 0)
    await ctx.pool.query(
      `INSERT INTO invoices
         (id, profile_id, state, total_amount, paid_amount, issued_at, due_at)
       VALUES ($1, $2, $3::invoice_state, 1000000, $4, $5, $6)`,
      [id, PROFILE_ID, opts.state, paid, ISSUED, opts.dueAt ?? DUE],
    )
    return id
  }

  async function insertSchedule(opts: {
    invoiceId: string
    offset: number
    channel: string
    scheduledAt: Date
    status?: string
    sentAt?: Date | null
  }): Promise<string> {
    const result = await ctx.pool.query<{ id: string }>(
      `INSERT INTO invoice_reminder_schedule
         (invoice_id, "offset", channel, scheduled_at, status, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        opts.invoiceId,
        opts.offset,
        opts.channel,
        opts.scheduledAt,
        opts.status ?? 'scheduled',
        opts.sentAt ?? null,
      ],
    )
    return result.rows[0]!.id
  }

  it('rejects text[] comparison against invoice_state (the production failure)', async () => {
    await expect(
      ctx.pool.query(BROKEN_TEXT_ARRAY_SQL, [[...REMINDER_STOP_STATES]]),
    ).rejects.toMatchObject({
      code: '42883',
    })
  })

  it('candidate query returns only due scheduled groups on eligible invoices', async () => {
    const unpaid = await insertInvoice({ state: 'Unpaid' })
    const overdue = await insertInvoice({ state: 'Overdue' })
    const paid = await insertInvoice({ state: 'Paid', paidAmount: 1_000_000 })
    const cancelled = await insertInvoice({ state: 'Cancelled' })

    await insertSchedule({
      invoiceId: unpaid,
      offset: -7,
      channel: 'in_app',
      scheduledAt: DUE_SCHEDULED,
    })
    await insertSchedule({
      invoiceId: unpaid,
      offset: -7,
      channel: 'email',
      scheduledAt: DUE_SCHEDULED,
    })
    await insertSchedule({
      invoiceId: unpaid,
      offset: -3,
      channel: 'in_app',
      scheduledAt: FUTURE_SCHEDULED,
    })
    await insertSchedule({
      invoiceId: overdue,
      offset: 0,
      channel: 'in_app',
      scheduledAt: DUE_SCHEDULED,
    })
    await insertSchedule({
      invoiceId: paid,
      offset: -7,
      channel: 'in_app',
      scheduledAt: DUE_SCHEDULED,
    })
    await insertSchedule({
      invoiceId: cancelled,
      offset: -7,
      channel: 'in_app',
      scheduledAt: DUE_SCHEDULED,
    })
    const alreadySentInvoice = await insertInvoice({ state: 'Unpaid' })
    await insertSchedule({
      invoiceId: alreadySentInvoice,
      offset: -7,
      channel: 'in_app',
      scheduledAt: DUE_SCHEDULED,
      status: 'sent',
      sentAt: NOW,
    })

    const result = await ctx.pool.query<{ invoice_id: string; offset: number }>(
      FIND_DUE_REMINDER_GROUPS_SQL,
      [NOW, [...REMINDER_STOP_STATES], 50],
    )
    const keys = result.rows
      .map((row) => `${row.invoice_id}:${row.offset}`)
      .sort()
    expect(keys).toEqual([`${overdue}:0`, `${unpaid}:-7`].sort())
  })

  it('sends due reminders via the outbox and stamps sent_at', async () => {
    const invoiceId = await insertInvoice({ state: 'Unpaid' })
    await insertSchedule({
      invoiceId,
      offset: -7,
      channel: 'in_app',
      scheduledAt: DUE_SCHEDULED,
    })
    await insertSchedule({
      invoiceId,
      offset: -7,
      channel: 'email',
      scheduledAt: DUE_SCHEDULED,
    })
    await insertSchedule({
      invoiceId,
      offset: -3,
      channel: 'in_app',
      scheduledAt: FUTURE_SCHEDULED,
    })

    const result = await sendDueInvoiceReminders({ pool: ctx.pool, now: NOW })
    expect(result).toMatchObject({ scanned: 1, sent: 1, skipped: 0, errors: [] })

    const schedule = await ctx.pool.query<{
      offset: number
      channel: string
      status: string
      sent_at: Date | null
    }>(
      `SELECT "offset", channel, status, sent_at
         FROM invoice_reminder_schedule
         WHERE invoice_id = $1
         ORDER BY "offset" ASC, channel ASC`,
      [invoiceId],
    )
    const sent = schedule.rows.filter((row) => row.offset === -7)
    expect(sent).toHaveLength(2)
    expect(sent.every((row) => row.status === 'sent')).toBe(true)
    expect(sent.every((row) => row.sent_at !== null)).toBe(true)
    const future = schedule.rows.find((row) => row.offset === -3)
    expect(future?.status).toBe('scheduled')
    expect(future?.sent_at).toBeNull()

    const outbox = await ctx.pool.query<{
      event_key: string
      profile_id: string
      user_id: string | null
      channels: string[]
      status: string
      idempotency_key: string
      payload: { invoiceId: string; offset: number }
    }>(`SELECT event_key, profile_id, user_id, channels, status, idempotency_key, payload
         FROM notification_outbox`)
    expect(outbox.rows).toHaveLength(1)
    expect(outbox.rows[0]).toMatchObject({
      event_key: PAYMENT_INVOICE_REMINDER_EVENT_KEY,
      profile_id: PROFILE_ID,
      user_id: USER_ID,
      status: 'queued',
      idempotency_key: reminderOutboxIdempotencyKey(invoiceId, -7),
    })
    expect(outbox.rows[0]!.channels.sort()).toEqual(['email', 'in_app'])
    expect(outbox.rows[0]!.payload).toMatchObject({ invoiceId, offset: -7 })

    const jobs = await ctx.pool.query<{ channel: string }>(
      `SELECT channel FROM notification_job ORDER BY channel ASC`,
    )
    expect(jobs.rows.map((row) => row.channel)).toEqual(['email', 'in_app'])
  })

  it('does not send when the invoice is Paid, Cancelled, or Refunded', async () => {
    const paid = await insertInvoice({ state: 'Paid', paidAmount: 1_000_000 })
    const cancelled = await insertInvoice({ state: 'Cancelled' })
    const refunded = await insertInvoice({ state: 'Refunded' })
    for (const invoiceId of [paid, cancelled, refunded]) {
      await insertSchedule({
        invoiceId,
        offset: -7,
        channel: 'in_app',
        scheduledAt: DUE_SCHEDULED,
      })
    }

    const result = await sendDueInvoiceReminders({ pool: ctx.pool, now: NOW })
    expect(result.scanned).toBe(0)
    expect(result.sent).toBe(0)

    const leftover = await ctx.pool.query<{ status: string }>(
      `SELECT status FROM invoice_reminder_schedule`,
    )
    expect(leftover.rows.every((row) => row.status === 'scheduled')).toBe(true)

    const outbox = await ctx.pool.query(`SELECT id FROM notification_outbox`)
    expect(outbox.rows).toHaveLength(0)
  })

  it('is a no-op on a second pass (already sent)', async () => {
    const invoiceId = await insertInvoice({ state: 'Unpaid' })
    await insertSchedule({
      invoiceId,
      offset: -7,
      channel: 'in_app',
      scheduledAt: DUE_SCHEDULED,
    })

    const first = await sendDueInvoiceReminders({ pool: ctx.pool, now: NOW })
    expect(first.sent).toBe(1)
    const second = await sendDueInvoiceReminders({ pool: ctx.pool, now: NOW })
    expect(second.scanned).toBe(0)
    expect(second.sent).toBe(0)

    const outbox = await ctx.pool.query(`SELECT id FROM notification_outbox`)
    expect(outbox.rows).toHaveLength(1)
  })
})
