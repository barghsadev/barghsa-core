import { describe, it, expect, vi } from 'vitest'
import type { Pool } from 'pg'
import { REMINDER_STOP_STATES } from '@barghsa/shared/finance'
import { CANCEL_FUTURE_INVOICE_REMINDERS_SQL } from './reminder-canceller.js'
import {
  DEFAULT_REMINDER_SEND_BATCH_SIZE,
  DEFAULT_REMINDER_SEND_INTERVAL_MS,
  FIND_DUE_REMINDER_GROUPS_SQL,
  INVOICE_REMINDER_SEND_JOB_TYPE,
  PAYMENT_INVOICE_REMINDER_EVENT_KEY,
  channelsForOutbox,
  reminderOutboxIdempotencyKey,
  sendDueInvoiceReminders,
} from './reminder-sender.js'

/**
 * ReminderSender unit tests (S-04.1.04, T-04.1.04.03).
 *
 * `sendDueInvoiceReminders` is exercised with an injected fake pool so the
 * candidate query, per-group lock + invoice-state re-check, outbox enqueue,
 * and `sent` stamp are covered DB-free.
 */

interface FakeDb {
  pool: { connect: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn> }
  calls: Array<{ sql: string; params: unknown[] }>
}

function makeFakeDb(
  onSql: (sql: string, params: unknown[]) => { rows?: unknown[]; rowCount?: number },
): FakeDb {
  const calls: Array<{ sql: string; params: unknown[] }> = []
  const respond = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params })
    const result = onSql(sql, params)
    return { rows: result.rows ?? [], rowCount: result.rowCount ?? result.rows?.length ?? 0 }
  }
  const client = { query: respond, release: vi.fn() }
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
    query: respond,
  }
  return { pool: pool as never, calls }
}

const NOW = new Date('2026-08-31T12:00:00.000Z')
const DUE = new Date('2026-09-07T12:00:00.000Z')
const SCHEDULED = new Date('2026-08-31T09:00:00.000Z')
const INVOICE_ID = 'inv-unpaid'
const PROFILE_ID = '11111111-1111-7111-8111-111111111111'
const USER_ID = 'user-owner'
const ROW_IN_APP = 'sched-in-app'
const ROW_EMAIL = 'sched-email'

function sendOptions(
  db: FakeDb,
  overrides: Record<string, unknown> = {},
) {
  const logger = { warn: vi.fn(), info: vi.fn() }
  const enqueue = vi.fn().mockResolvedValue({ outboxId: 'outbox-1', inserted: true })
  return {
    pool: db.pool as unknown as Pool,
    logger,
    now: NOW,
    enqueue,
    ...overrides,
  }
}

function dueGroup(invoiceId = INVOICE_ID, offset = -7) {
  return { invoice_id: invoiceId, offset, scheduled_at: SCHEDULED }
}

function scheduleRow(
  extras: Partial<{ id: string; channel: string; offset: number }> = {},
) {
  return {
    id: extras.id ?? ROW_IN_APP,
    invoice_id: INVOICE_ID,
    offset: extras.offset ?? -7,
    channel: extras.channel ?? 'in_app',
    scheduled_at: SCHEDULED,
    status: 'scheduled',
  }
}

function invoiceRow(
  extras: Partial<{ state: string; profile_id: string | null; user_id: string | null }> = {},
) {
  return {
    id: INVOICE_ID,
    state: extras.state ?? 'Unpaid',
    profile_id: extras.profile_id === undefined ? PROFILE_ID : extras.profile_id,
    due_at: DUE,
    user_id: extras.user_id === undefined ? USER_ID : extras.user_id,
  }
}

function defaultHandler(
  groups: ReturnType<typeof dueGroup>[] = [dueGroup()],
  lockedRows: ReturnType<typeof scheduleRow>[] = [scheduleRow(), scheduleRow({ id: ROW_EMAIL, channel: 'email' })],
  invoice: ReturnType<typeof invoiceRow>[] = [invoiceRow()],
  markCount?: number,
) {
  return (sql: string): { rows?: unknown[]; rowCount?: number } => {
    if (sql.includes('FROM invoice_reminder_schedule s') && sql.includes('GROUP BY')) {
      return { rows: groups }
    }
    if (sql.includes('FROM invoice_reminder_schedule') && sql.includes('FOR UPDATE SKIP LOCKED')) {
      return { rows: lockedRows }
    }
    if (sql.includes('FROM invoices i') && sql.includes('FOR UPDATE OF i SKIP LOCKED')) {
      return { rows: invoice }
    }
    if (sql.includes("SET status = 'sent'")) {
      const count = markCount ?? lockedRows.length
      return { rows: [], rowCount: count }
    }
    if (sql.includes("SET status = 'cancelled'")) {
      return { rows: [], rowCount: lockedRows.length }
    }
    return { rows: [] }
  }
}

describe('ReminderSender contract (T-04.1.04.03)', () => {
  it('exposes the hourly cadence and background-job type', () => {
    expect(INVOICE_REMINDER_SEND_JOB_TYPE).toBe('invoice_reminder_sender')
    expect(DEFAULT_REMINDER_SEND_INTERVAL_MS).toBe(60 * 60 * 1000)
    expect(DEFAULT_REMINDER_SEND_BATCH_SIZE).toBe(200)
    expect(PAYMENT_INVOICE_REMINDER_EVENT_KEY).toBe('payment.invoice_reminder')
  })

  it('binds stop states to invoice_state[] and picks due scheduled rows oldest-first', () => {
    expect(FIND_DUE_REMINDER_GROUPS_SQL).toContain("s.status = 'scheduled'")
    expect(FIND_DUE_REMINDER_GROUPS_SQL).toContain('s.scheduled_at <= $1')
    expect(FIND_DUE_REMINDER_GROUPS_SQL).toContain('NOT (i.state = ANY($2::invoice_state[]))')
    expect(FIND_DUE_REMINDER_GROUPS_SQL).not.toContain('$2::text[]')
    expect(FIND_DUE_REMINDER_GROUPS_SQL).toContain('GROUP BY s.invoice_id, s."offset"')
    expect(FIND_DUE_REMINDER_GROUPS_SQL).toContain('ORDER BY MIN(s.scheduled_at) ASC')
    expect(FIND_DUE_REMINDER_GROUPS_SQL).toContain('LIMIT $3')
  })

  it('keeps outbox idempotency stable per (invoice, offset) and distinct across offsets', () => {
    const a = reminderOutboxIdempotencyKey(INVOICE_ID, -7)
    const b = reminderOutboxIdempotencyKey(INVOICE_ID, -7)
    const c = reminderOutboxIdempotencyKey(INVOICE_ID, -3)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('orders channels in-app first and prepends in_app when only external channels are due', () => {
    expect(channelsForOutbox(['email', 'in_app', 'sms'])).toEqual(['in_app', 'email', 'sms'])
    expect(channelsForOutbox(['sms'])).toEqual(['in_app', 'sms'])
    expect(channelsForOutbox([])).toEqual(['in_app'])
  })

  it('enqueues one outbox event and marks due rows sent for an Unpaid invoice', async () => {
    const db = makeFakeDb(defaultHandler())
    const options = sendOptions(db)
    const result = await sendDueInvoiceReminders(options)

    expect(result).toEqual({ scanned: 1, sent: 1, skipped: 0, truncated: false, errors: [] })
    expect(options.enqueue).toHaveBeenCalledTimes(1)
    expect(options.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        profileId: PROFILE_ID,
        userId: USER_ID,
        eventKey: PAYMENT_INVOICE_REMINDER_EVENT_KEY,
        channels: ['in_app', 'email'],
        idempotencyKey: reminderOutboxIdempotencyKey(INVOICE_ID, -7),
        status: 'queued',
        payload: expect.objectContaining({
          invoiceId: INVOICE_ID,
          offset: -7,
          dueAt: DUE.toISOString(),
        }),
      }),
    )

    const find = db.calls.find((c) => c.sql.includes('GROUP BY'))
    expect(find?.params[0]).toEqual(NOW)
    expect(find?.params[1]).toEqual([...REMINDER_STOP_STATES])
    expect(find?.params[2]).toBe(DEFAULT_REMINDER_SEND_BATCH_SIZE)

    const mark = db.calls.find((c) => c.sql.includes("SET status = 'sent'"))
    expect(mark?.params[0]).toEqual([ROW_IN_APP, ROW_EMAIL])
    expect(mark?.params[1]).toEqual(NOW)
  })

  it('still sends when the invoice is Overdue', async () => {
    const db = makeFakeDb(defaultHandler(undefined, undefined, [invoiceRow({ state: 'Overdue' })]))
    const result = await sendDueInvoiceReminders(sendOptions(db))
    expect(result.sent).toBe(1)
    expect(result.skipped).toBe(0)
  })

  it('skips a lock that returns no schedule rows', async () => {
    const db = makeFakeDb(defaultHandler([dueGroup()], []))
    const options = sendOptions(db)
    const result = await sendDueInvoiceReminders(options)
    expect(result).toMatchObject({ scanned: 1, sent: 0, skipped: 1 })
    expect(options.enqueue).not.toHaveBeenCalled()
  })

  it('cancels remaining scheduled rows when the invoice was paid after the candidate query', async () => {
    const db = makeFakeDb(defaultHandler(undefined, undefined, [invoiceRow({ state: 'Paid' })]))
    const options = sendOptions(db)
    const result = await sendDueInvoiceReminders(options)
    expect(result.skipped).toBe(1)
    expect(result.sent).toBe(0)
    expect(options.enqueue).not.toHaveBeenCalled()
    const cancel = db.calls.find((c) => c.sql === CANCEL_FUTURE_INVOICE_REMINDERS_SQL)
    expect(cancel?.params).toEqual([INVOICE_ID])
    expect(db.calls.some((c) => c.sql === 'COMMIT')).toBe(true)
    expect(db.calls.some((c) => c.sql === 'ROLLBACK')).toBe(false)
  })

  it('cancels remaining scheduled rows for Cancelled and Refunded invoices under lock', async () => {
    for (const state of ['Cancelled', 'Refunded'] as const) {
      const db = makeFakeDb(defaultHandler(undefined, undefined, [invoiceRow({ state })]))
      const options = sendOptions(db)
      const result = await sendDueInvoiceReminders(options)
      expect(result.skipped).toBe(1)
      expect(result.sent).toBe(0)
      expect(options.enqueue).not.toHaveBeenCalled()
      expect(db.calls.some((c) => c.sql === CANCEL_FUTURE_INVOICE_REMINDERS_SQL)).toBe(true)
      expect(db.calls.some((c) => c.sql === 'COMMIT')).toBe(true)
    }
  })

  it('skips when the invoice row is locked by a sibling worker', async () => {
    const db = makeFakeDb(defaultHandler(undefined, undefined, []))
    const options = sendOptions(db)
    const result = await sendDueInvoiceReminders(options)
    expect(result.skipped).toBe(1)
    expect(options.enqueue).not.toHaveBeenCalled()
  })

  it('skips when the invoice has no profile to deliver to', async () => {
    const db = makeFakeDb(defaultHandler(undefined, undefined, [invoiceRow({ profile_id: null })]))
    const options = sendOptions(db)
    const result = await sendDueInvoiceReminders(options)
    expect(result.skipped).toBe(1)
    expect(options.enqueue).not.toHaveBeenCalled()
  })

  it('records a per-group error and continues the batch when enqueue throws', async () => {
    const original = defaultHandler(
      [dueGroup(), dueGroup('inv-2', -3)],
      [scheduleRow()],
      [invoiceRow()],
    )
    const db = makeFakeDb((sql) => {
      if (sql.includes('GROUP BY')) {
        return { rows: [dueGroup(), dueGroup('inv-2', -3)] }
      }
      return original(sql)
    })
    let groupsSeen = 0
    const enqueue = vi.fn().mockImplementation(async () => {
      groupsSeen += 1
      if (groupsSeen === 1) throw new Error('outbox down')
      return { outboxId: 'outbox-2', inserted: true }
    })
    const result = await sendDueInvoiceReminders(sendOptions(db, { enqueue }))
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('outbox down')
    expect(result.sent).toBe(1)
    expect(enqueue).toHaveBeenCalledTimes(2)
  })

  it('sets truncated when the candidate query hits the batch cap', async () => {
    const db = makeFakeDb(defaultHandler([dueGroup()]))
    const result = await sendDueInvoiceReminders(sendOptions(db, { batchSize: 1 }))
    expect(result.truncated).toBe(true)
    expect(result.scanned).toBe(1)
  })

  it('marks sent even when the outbox row is a duplicate idempotency hit', async () => {
    const db = makeFakeDb(defaultHandler())
    const enqueue = vi.fn().mockResolvedValue({ outboxId: null, inserted: false })
    const result = await sendDueInvoiceReminders(sendOptions(db, { enqueue }))
    expect(result.sent).toBe(1)
    const mark = db.calls.find((c) => c.sql.includes("SET status = 'sent'"))
    expect(mark).toBeDefined()
  })
})
