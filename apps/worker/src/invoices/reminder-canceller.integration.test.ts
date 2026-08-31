/**
 * Real-PostgreSQL tests for T-04.1.04.06: when an invoice enters
 * Paid / Cancelled / Refunded, remaining `scheduled` reminder rows
 * become `cancelled`. `sent` rows stay sent; other invoices are untouched.
 *
 * Covers the invoices-state trigger (migration 0063), the application
 * UPDATE, and the one-shot catch-up for invoices already in a stop state.
 */

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createIsolatedTestDb, dropTestSchema } from '@barghsa/db/test'
import type { IsolatedTestDb } from '@barghsa/db/test'
import { REMINDER_STOP_STATES } from '@barghsa/shared/finance'
import {
  cancelFutureInvoiceReminders,
  cancelScheduledRemindersForStoppedInvoices,
} from './reminder-canceller.js'

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
const CANCEL_ON_STOP_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0063_cancel_reminders_on_invoice_stop_state.sql',
)

const USER_ID = 'reminder-cancel-owner'
const PROFILE_ID = '11111111-1111-7111-8111-111111111111'
const DUE = new Date('2026-09-07T12:00:00.000Z')
const ISSUED = new Date('2026-08-24T12:00:00.000Z')
const PAST_DUE = new Date('2026-08-30T09:00:00.000Z')
const FUTURE = new Date('2026-09-14T09:00:00.000Z')
const SENT_AT = new Date('2026-08-30T09:05:00.000Z')

describe('cancel invoice reminders on stop state — real PostgreSQL (T-04.1.04.06)', () => {
  let ctx: IsolatedTestDb

  beforeAll(async () => {
    ctx = await createIsolatedTestDb('test_', 2)

    await ctx.pool.query(readFileSync(UUIDV7_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(`CREATE TYPE invoice_state AS ENUM (
      'Draft', 'Unpaid', 'PaymentUnderReview', 'PartiallyFunded', 'Paid',
      'Overdue', 'Cancelled', 'PartiallyRefunded', 'Refunded'
    )`)
    await ctx.pool.query(`CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY
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
    await ctx.pool.query(readFileSync(CANCEL_ON_STOP_MIGRATION, 'utf-8').trim())

    await ctx.pool.query(`INSERT INTO users (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [
      USER_ID,
    ])
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
    paidAmount?: number
  }): Promise<string> {
    const id = randomUUID()
    const paid = opts.paidAmount ?? (opts.state === 'Paid' || opts.state === 'Refunded' ? 1_000_000 : 0)
    await ctx.pool.query(
      `INSERT INTO invoices
         (id, profile_id, state, total_amount, paid_amount, issued_at, due_at)
       VALUES ($1, $2, $3::invoice_state, 1000000, $4, $5, $6)`,
      [id, PROFILE_ID, opts.state, paid, ISSUED, DUE],
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

  async function statuses(invoiceId: string): Promise<Array<{ status: string; sent_at: Date | null }>> {
    const result = await ctx.pool.query<{ status: string; sent_at: Date | null }>(
      `SELECT status, sent_at FROM invoice_reminder_schedule
       WHERE invoice_id = $1
       ORDER BY "offset" ASC, channel ASC`,
      [invoiceId],
    )
    return result.rows
  }

  it.each(['Paid', 'Cancelled', 'Refunded'] as const)(
    'trigger cancels remaining scheduled rows when state becomes %s',
    async (toState) => {
      const invoiceId = await insertInvoice({ state: 'Unpaid' })
      const sibling = await insertInvoice({ state: 'Unpaid' })
      await insertSchedule({
        invoiceId,
        offset: -7,
        channel: 'in_app',
        scheduledAt: PAST_DUE,
      })
      await insertSchedule({
        invoiceId,
        offset: 7,
        channel: 'email',
        scheduledAt: FUTURE,
      })
      await insertSchedule({
        invoiceId,
        offset: 0,
        channel: 'sms',
        scheduledAt: PAST_DUE,
        status: 'sent',
        sentAt: SENT_AT,
      })
      await insertSchedule({
        invoiceId: sibling,
        offset: -3,
        channel: 'in_app',
        scheduledAt: FUTURE,
      })

      await ctx.pool.query(`UPDATE invoices SET state = $2::invoice_state WHERE id = $1`, [
        invoiceId,
        toState,
      ])

      const rows = await statuses(invoiceId)
      expect(rows.filter((row) => row.status === 'cancelled')).toHaveLength(2)
      expect(rows.filter((row) => row.status === 'sent')).toHaveLength(1)
      expect(rows.find((row) => row.status === 'sent')?.sent_at).not.toBeNull()
      expect(await statuses(sibling)).toEqual([
        expect.objectContaining({ status: 'scheduled', sent_at: null }),
      ])
    },
  )

  it('does not cancel when the invoice becomes Overdue or PartiallyRefunded', async () => {
    const overdue = await insertInvoice({ state: 'Unpaid' })
    const partial = await insertInvoice({ state: 'Paid', paidAmount: 1_000_000 })
    await insertSchedule({
      invoiceId: overdue,
      offset: 1,
      channel: 'in_app',
      scheduledAt: FUTURE,
    })
    await insertSchedule({
      invoiceId: partial,
      offset: 1,
      channel: 'email',
      scheduledAt: FUTURE,
    })

    await ctx.pool.query(`UPDATE invoices SET state = 'Overdue' WHERE id = $1`, [overdue])
    await ctx.pool.query(`UPDATE invoices SET state = 'PartiallyRefunded' WHERE id = $1`, [partial])

    expect(await statuses(overdue)).toEqual([expect.objectContaining({ status: 'scheduled' })])
    expect(await statuses(partial)).toEqual([expect.objectContaining({ status: 'scheduled' })])
  })

  it('does not re-fire when state is written to the same stop state', async () => {
    const invoiceId = await insertInvoice({ state: 'Paid', paidAmount: 1_000_000 })
    await insertSchedule({
      invoiceId,
      offset: -1,
      channel: 'in_app',
      scheduledAt: FUTURE,
      status: 'cancelled',
    })

    await ctx.pool.query(`UPDATE invoices SET state = 'Paid' WHERE id = $1`, [invoiceId])
    expect(await statuses(invoiceId)).toEqual([expect.objectContaining({ status: 'cancelled' })])
  })

  it('application helper cancels only scheduled rows for one invoice', async () => {
    const invoiceId = await insertInvoice({ state: 'Unpaid' })
    await insertSchedule({
      invoiceId,
      offset: -7,
      channel: 'in_app',
      scheduledAt: FUTURE,
    })
    await insertSchedule({
      invoiceId,
      offset: 0,
      channel: 'email',
      scheduledAt: PAST_DUE,
      status: 'sent',
      sentAt: SENT_AT,
    })

    const result = await cancelFutureInvoiceReminders(ctx.pool, invoiceId)
    expect(result.cancelled).toBe(1)
    const rows = await statuses(invoiceId)
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'cancelled', sent_at: null }),
        expect.objectContaining({ status: 'sent' }),
      ]),
    )
  })

  it('catch-up UPDATE cancels leftover scheduled rows on invoices already in a stop state', async () => {
    const paid = await insertInvoice({ state: 'Paid', paidAmount: 1_000_000 })
    const unpaid = await insertInvoice({ state: 'Unpaid' })
    await insertSchedule({
      invoiceId: paid,
      offset: 7,
      channel: 'in_app',
      scheduledAt: FUTURE,
    })
    await insertSchedule({
      invoiceId: unpaid,
      offset: 7,
      channel: 'sms',
      scheduledAt: FUTURE,
    })

    const result = await cancelScheduledRemindersForStoppedInvoices({ pool: ctx.pool })
    expect(result.cancelled).toBe(1)
    expect(await statuses(paid)).toEqual([expect.objectContaining({ status: 'cancelled' })])
    expect(await statuses(unpaid)).toEqual([expect.objectContaining({ status: 'scheduled' })])
  })

  it('catch-up SQL rejects text[] comparison against invoice_state', async () => {
    await expect(
      ctx.pool.query(
        `UPDATE invoice_reminder_schedule AS s
         SET status = 'cancelled'
         FROM invoices AS i
         WHERE s.invoice_id = i.id
           AND NOT (i.state = ANY($1::text[]))`,
        [[...REMINDER_STOP_STATES]],
      ),
    ).rejects.toMatchObject({ code: '42883' })
  })

  it('migration 0063 is idempotent — re-running keeps the trigger', async () => {
    await expect(
      ctx.pool.query(readFileSync(CANCEL_ON_STOP_MIGRATION, 'utf-8').trim()),
    ).resolves.toBeDefined()

    const invoiceId = await insertInvoice({ state: 'Unpaid' })
    await insertSchedule({
      invoiceId,
      offset: 1,
      channel: 'in_app',
      scheduledAt: FUTURE,
    })
    await ctx.pool.query(`UPDATE invoices SET state = 'Cancelled' WHERE id = $1`, [invoiceId])
    expect(await statuses(invoiceId)).toEqual([expect.objectContaining({ status: 'cancelled' })])
  })
})
