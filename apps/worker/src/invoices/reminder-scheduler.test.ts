import { describe, it, expect, vi } from 'vitest'
import type { Pool } from 'pg'
import {
  INVOICE_REMINDER_CHANNELS,
  INVOICE_REMINDER_OFFSETS,
  REMINDER_STOP_STATES,
  mergeReminderOffsetToggles,
} from '@barghsa/shared/finance'
import {
  INVOICE_REMINDER_CHANNELS as DB_CHANNELS,
  INVOICE_REMINDER_OFFSETS as DB_OFFSETS,
} from '@barghsa/db'
import { DEFAULT_DELIVERY_WINDOW } from '@barghsa/shared/notifications'
import {
  DEFAULT_REMINDER_SCHEDULE_BATCH_SIZE,
  FIND_UNSCHEDULED_ISSUED_INVOICES_SQL,
  INVOICE_REMINDER_JOB_TYPE,
  REMINDER_SCHEDULE_CATCH_UP_GRACE_MS,
  REMINDER_SCHEDULE_HORIZON_DAYS,
  isElapsedReminder,
  planInvoiceReminders,
  reminderWindowForProfile,
  scheduleIssuedInvoiceReminders,
  snapToDaytimeWindow,
} from './reminder-scheduler.js'

/**
 * ReminderScheduler unit tests (S-04.1.04, T-04.1.04.02).
 *
 * `scheduleIssuedInvoiceReminders` is exercised with an injected fake pool
 * so the candidate query, per-row lock + eligibility re-check, and the
 * multi-row INSERT are covered DB-free. Datetime / window helpers are
 * pure and asserted against Asia/Tehran wall-clock boundaries.
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

const TEHRAN = DEFAULT_DELIVERY_WINDOW
const DUE_INSIDE = new Date('2026-09-07T12:00:00.000Z') // 15:30 Tehran
const ISSUED = new Date('2026-08-31T12:00:00.000Z')

function scheduleOptions(db: FakeDb, overrides: Record<string, unknown> = {}) {
  const logger = { warn: vi.fn(), info: vi.fn() }
  return {
    pool: db.pool as unknown as Pool,
    logger,
    deliveryWindow: TEHRAN,
    now: ISSUED,
    ...overrides,
  }
}

function insertedOffsets(params: unknown[]): number[] {
  const offsets: number[] = []
  for (let i = 1; i < params.length; i += 3) {
    offsets.push(Number(params[i]))
  }
  return offsets
}

function unpaidCandidate(
  id = 'inv-unpaid',
  extras: Partial<{
    state: string
    due_at: Date
    issued_at: Date
    service_type: string | null
    timezone: string
    notification_preferences: string
  }> = {},
) {
  return {
    id,
    state: extras.state ?? 'Unpaid',
    due_at: extras.due_at ?? DUE_INSIDE,
    issued_at: extras.issued_at ?? ISSUED,
    service_type: extras.service_type ?? null,
    timezone: extras.timezone ?? 'Asia/Tehran',
    notification_preferences: extras.notification_preferences ?? 'IN_APP',
  }
}

function defaultHandler(
  candidates: ReturnType<typeof unpaidCandidate>[] = [unpaidCandidate()],
  locked: ReturnType<typeof unpaidCandidate>[] | 'match' = 'match',
  existingCount = 0,
) {
  return (sql: string): { rows?: unknown[]; rowCount?: number } => {
    if (sql.includes('FROM invoices i') && sql.includes('NOT EXISTS')) {
      return { rows: candidates }
    }
    if (sql.includes('FOR UPDATE OF i SKIP LOCKED')) {
      return { rows: locked === 'match' ? candidates : locked }
    }
    if (sql.includes('FROM invoice_reminder_schedule WHERE invoice_id')) {
      return { rows: existingCount > 0 ? [{ '?column?': 1 }] : [], rowCount: existingCount }
    }
    if (sql.includes('INSERT INTO invoice_reminder_schedule')) {
      return { rows: [], rowCount: 6 }
    }
    return { rows: [] }
  }
}

describe('ReminderScheduler contract (T-04.1.04.02)', () => {
  it('exposes the background-job type the worker recorder uses', () => {
    expect(INVOICE_REMINDER_JOB_TYPE).toBe('invoice_reminder_scheduler')
  })

  it('keeps shared offsets/channels in lock-step with the db schema', () => {
    expect([...INVOICE_REMINDER_OFFSETS]).toEqual([...DB_OFFSETS])
    expect([...INVOICE_REMINDER_CHANNELS]).toEqual([...DB_CHANNELS])
  })

  it('binds stop states to invoice_state[] and skips invoices that already have rows', () => {
    expect(FIND_UNSCHEDULED_ISSUED_INVOICES_SQL).toContain(
      'NOT (i.state = ANY($1::invoice_state[]))',
    )
    expect(FIND_UNSCHEDULED_ISSUED_INVOICES_SQL).not.toContain('$1::text[]')
    expect(FIND_UNSCHEDULED_ISSUED_INVOICES_SQL).toContain('issued_at IS NOT NULL')
    expect(FIND_UNSCHEDULED_ISSUED_INVOICES_SQL).toContain('due_at IS NOT NULL')
    expect(FIND_UNSCHEDULED_ISSUED_INVOICES_SQL).toContain(
      'FROM invoice_reminder_schedule s WHERE s.invoice_id = i.id',
    )
    expect(FIND_UNSCHEDULED_ISSUED_INVOICES_SQL).toContain('ORDER BY i.issued_at ASC, i.id ASC')
    expect(FIND_UNSCHEDULED_ISSUED_INVOICES_SQL).toContain('LIMIT $2')
    expect(REMINDER_SCHEDULE_HORIZON_DAYS).toBe(8)
    expect(FIND_UNSCHEDULED_ISSUED_INVOICES_SQL).toContain(
      `INTERVAL '${REMINDER_SCHEDULE_HORIZON_DAYS} days'`,
    )
    expect(FIND_UNSCHEDULED_ISSUED_INVOICES_SQL).toContain(
      `INTERVAL '${REMINDER_SCHEDULE_CATCH_UP_GRACE_MS / 1000} seconds'`,
    )
    expect(FIND_UNSCHEDULED_ISSUED_INVOICES_SQL).toContain('$3::timestamptz')
    expect(FIND_UNSCHEDULED_ISSUED_INVOICES_SQL).toContain('$4::timestamptz IS NULL')
    expect(FIND_UNSCHEDULED_ISSUED_INVOICES_SQL).toContain(
      '(i.issued_at, i.id) > ($4::timestamptz, $5::uuid)',
    )
    expect(FIND_UNSCHEDULED_ISSUED_INVOICES_SQL).toContain(
      "metadata #>> '{due,serviceType}'",
    )
  })
})

describe('snapToDaytimeWindow / reminderWindowForProfile', () => {
  it('leaves an in-window instant unchanged', () => {
    // 12:00Z == 15:30 Tehran → inside 09:00–21:00
    expect(snapToDaytimeWindow(DUE_INSIDE, TEHRAN).toISOString()).toBe(DUE_INSIDE.toISOString())
  })

  it('snaps a pre-open instant to today\'s window open', () => {
    // 02:00Z == 05:30 Tehran → 09:00 Tehran == 05:30Z
    const snapped = snapToDaytimeWindow(new Date('2026-09-07T02:00:00.000Z'), TEHRAN)
    expect(snapped.toISOString()).toBe('2026-09-07T05:30:00.000Z')
  })

  it('snaps a post-close instant to tomorrow\'s window open', () => {
    // 18:00Z == 21:30 Tehran → 2026-09-08 09:00 Tehran == 05:30Z
    const snapped = snapToDaytimeWindow(new Date('2026-09-07T18:00:00.000Z'), TEHRAN)
    expect(snapped.toISOString()).toBe('2026-09-08T05:30:00.000Z')
  })

  it('uses the profile timezone with admin window hours', () => {
    const window = reminderWindowForProfile(
      { timezone: 'UTC', startHour: 8, endHour: 20 },
      'Asia/Tehran',
    )
    expect(window).toEqual({ timezone: 'Asia/Tehran', startHour: 8, endHour: 20 })
  })

  it('falls back to the admin timezone when the profile zone is invalid', () => {
    const admin = { timezone: 'UTC', startHour: 9, endHour: 21 }
    expect(reminderWindowForProfile(admin, 'Not/AZone').timezone).toBe('UTC')
    expect(reminderWindowForProfile(admin, '').timezone).toBe('UTC')
    expect(reminderWindowForProfile(admin, null).timezone).toBe('UTC')
  })
})

describe('planInvoiceReminders', () => {
  it('emits one row per canonical offset for in_app, inside the window', () => {
    const planned = planInvoiceReminders({
      dueAt: DUE_INSIDE,
      issuedAt: ISSUED,
      now: ISSUED,
      channels: ['in_app'],
      window: TEHRAN,
    })
    expect(planned).toHaveLength(6)
    expect(planned.map((row) => row.offset)).toEqual([...INVOICE_REMINDER_OFFSETS])
    expect(planned.every((row) => row.channel === 'in_app')).toBe(true)
    expect(planned.find((row) => row.offset === 0)?.scheduledAt.toISOString()).toBe(
      DUE_INSIDE.toISOString(),
    )
    expect(planned.find((row) => row.offset === -7)?.scheduledAt.toISOString()).toBe(
      '2026-08-31T12:00:00.000Z',
    )
    expect(planned.find((row) => row.offset === 7)?.scheduledAt.toISOString()).toBe(
      '2026-09-14T12:00:00.000Z',
    )
  })

  it('crosses offsets with enabled external channels', () => {
    const planned = planInvoiceReminders({
      dueAt: DUE_INSIDE,
      issuedAt: ISSUED,
      now: ISSUED,
      channels: ['in_app', 'email', 'sms'],
      window: TEHRAN,
    })
    expect(planned).toHaveLength(18)
    expect(planned.filter((row) => row.offset === 0).map((row) => row.channel)).toEqual([
      'in_app',
      'email',
      'sms',
    ])
  })

  it('applies the daytime window to every offset instant', () => {
    const dueOutside = new Date('2026-09-07T02:00:00.000Z')
    const issuedAt = new Date('2026-08-31T02:00:00.000Z')
    const planned = planInvoiceReminders({
      dueAt: dueOutside,
      issuedAt,
      now: issuedAt,
      channels: ['in_app'],
      window: TEHRAN,
    })
    expect(planned.find((row) => row.offset === 0)?.scheduledAt.toISOString()).toBe(
      '2026-09-07T05:30:00.000Z',
    )
    expect(planned.find((row) => row.offset === -7)?.scheduledAt.toISOString()).toBe(
      '2026-08-31T05:30:00.000Z',
    )
  })

  it('omits offsets whose instant predates issuedAt (short due period)', () => {
    // Issued 2 days before due: -7 and -3 fall before issuance.
    const issuedAt = new Date('2026-09-05T12:00:00.000Z')
    const planned = planInvoiceReminders({
      dueAt: DUE_INSIDE,
      issuedAt,
      now: issuedAt,
      channels: ['in_app'],
      window: TEHRAN,
    })
    expect(planned.map((row) => row.offset)).toEqual([-1, 0, 1, 7])
    expect(planned.every((row) => row.scheduledAt.getTime() >= issuedAt.getTime())).toBe(true)
  })

  it('omits offsets already elapsed when the catch-up poll runs late', () => {
    // 7-day invoice, worker first sees it 5 days later (2 days before due).
    const now = new Date('2026-09-05T12:00:00.000Z')
    const planned = planInvoiceReminders({
      dueAt: DUE_INSIDE,
      issuedAt: ISSUED,
      now,
      channels: ['in_app'],
      window: TEHRAN,
    })
    expect(planned.map((row) => row.offset)).toEqual([-1, 0, 1, 7])
    expect(planned.every((row) => row.scheduledAt.getTime() >= now.getTime())).toBe(true)
  })

  it('still queues the on-issue -7 offset when the 60s catch-up poll is slightly late', () => {
    const now = new Date(ISSUED.getTime() + 60_000)
    const planned = planInvoiceReminders({
      dueAt: DUE_INSIDE,
      issuedAt: ISSUED,
      now,
      channels: ['in_app'],
      window: TEHRAN,
    })
    expect(planned.map((row) => row.offset)).toEqual([...INVOICE_REMINDER_OFFSETS])
    expect(now.getTime() - ISSUED.getTime()).toBeLessThan(REMINDER_SCHEDULE_CATCH_UP_GRACE_MS)
  })

  it('omits a snapped instant that remains in the past after window alignment', () => {
    // Pre-open instant snaps to today's 09:00 Tehran, which is still before `now`.
    const instant = new Date('2026-09-05T02:00:00.000Z')
    const scheduledAt = snapToDaytimeWindow(instant, TEHRAN)
    const issuedAt = new Date('2026-08-31T12:00:00.000Z')
    const now = new Date('2026-09-05T12:00:00.000Z')
    expect(scheduledAt.toISOString()).toBe('2026-09-05T05:30:00.000Z')
    expect(
      isElapsedReminder({ instant, scheduledAt, issuedAt, now }),
    ).toBe(true)
  })

  it('omits admin-disabled offsets (T-04.1.04.05)', () => {
    const planned = planInvoiceReminders({
      dueAt: DUE_INSIDE,
      issuedAt: ISSUED,
      now: ISSUED,
      channels: ['in_app'],
      window: TEHRAN,
      enabledOffsets: [-3, -1, 0, 1],
    })
    expect(planned.map((row) => row.offset)).toEqual([-3, -1, 0, 1])
  })

  it('inserts nothing when every offset is disabled', () => {
    const planned = planInvoiceReminders({
      dueAt: DUE_INSIDE,
      issuedAt: ISSUED,
      now: ISSUED,
      channels: ['in_app'],
      window: TEHRAN,
      enabledOffsets: [],
    })
    expect(planned).toEqual([])
  })
})

describe('scheduleIssuedInvoiceReminders (T-04.1.04.02)', () => {
  it('selects issued invoices without schedule rows, oldest issued first, bounded', async () => {
    const db = makeFakeDb(defaultHandler())
    await scheduleIssuedInvoiceReminders(scheduleOptions(db))

    const find = db.calls.find((c) => c.sql.includes('NOT EXISTS'))
    expect(find).toBeDefined()
    expect(find!.params[0]).toEqual([...REMINDER_STOP_STATES])
    expect(find!.params[1]).toBe(DEFAULT_REMINDER_SCHEDULE_BATCH_SIZE)
    expect(find!.params[2]).toEqual(ISSUED)
    expect(find!.params[3]).toBeNull()
    expect(find!.params[4]).toBeNull()
    expect(find!.sql).toContain('state = ANY($1::invoice_state[])')
    expect(find!.sql).not.toContain('$1::text[]')
  })

  it('inserts six in_app rows for an Unpaid invoice with default preferences', async () => {
    const db = makeFakeDb(defaultHandler())
    const result = await scheduleIssuedInvoiceReminders(scheduleOptions(db))

    expect(result).toMatchObject({
      scanned: 1,
      scheduled: 1,
      skipped: 0,
      truncated: false,
      errors: [],
    })

    const insert = db.calls.find((c) => c.sql.includes('INSERT INTO invoice_reminder_schedule'))
    expect(insert).toBeDefined()
    expect(insert!.sql).toContain('"offset"')
    expect(insert!.sql).toContain('ON CONFLICT (invoice_id, "offset", channel) DO NOTHING')
    expect(insert!.params[0]).toBe('inv-unpaid')
    expect(insertedOffsets(insert!.params)).toEqual([...INVOICE_REMINDER_OFFSETS])
    const channels = []
    for (let i = 2; i < insert!.params.length; i += 3) {
      channels.push(insert!.params[i])
    }
    expect(channels).toEqual(['in_app', 'in_app', 'in_app', 'in_app', 'in_app', 'in_app'])
    expect(db.calls.some((c) => c.sql === 'COMMIT')).toBe(true)
  })

  it('omits disabled offsets for the invoice service type (T-04.1.04.05)', async () => {
    const row = unpaidCandidate('inv-electricity', { service_type: 'electricity' })
    const db = makeFakeDb(defaultHandler([row]))
    const toggles = mergeReminderOffsetToggles([
      { serviceType: 'electricity', offset: -7, enabled: false },
      { serviceType: 'electricity', offset: 7, enabled: false },
    ])
    const result = await scheduleIssuedInvoiceReminders(
      scheduleOptions(db, { reminderOffsetToggles: toggles }),
    )
    expect(result.scheduled).toBe(1)
    const insert = db.calls.find((c) => c.sql.includes('INSERT INTO invoice_reminder_schedule'))
    expect(insertedOffsets(insert!.params)).toEqual([-3, -1, 0, 1])
  })

  it('keeps the full offset set when the invoice has no service type', async () => {
    const db = makeFakeDb(defaultHandler([unpaidCandidate('inv-unknown', { service_type: null })]))
    const toggles = mergeReminderOffsetToggles([
      { serviceType: 'electricity', offset: -7, enabled: false },
    ])
    const result = await scheduleIssuedInvoiceReminders(
      scheduleOptions(db, { reminderOffsetToggles: toggles }),
    )
    expect(result.scheduled).toBe(1)
    const insert = db.calls.find((c) => c.sql.includes('INSERT INTO invoice_reminder_schedule'))
    expect(insertedOffsets(insert!.params)).toEqual([...INVOICE_REMINDER_OFFSETS])
  })

  it('inserts email and sms rows when those preferences are enabled', async () => {
    const row = unpaidCandidate('inv-multi', {
      notification_preferences: 'IN_APP,EMAIL,SMS',
    })
    const db = makeFakeDb(defaultHandler([row]))
    const result = await scheduleIssuedInvoiceReminders(scheduleOptions(db))
    expect(result.scheduled).toBe(1)

    const insert = db.calls.find((c) => c.sql.includes('INSERT INTO invoice_reminder_schedule'))
    expect(insert).toBeDefined()
    expect(insert!.params).toHaveLength(1 + 18 * 3)
    const channels = new Set<string>()
    for (let i = 2; i < insert!.params.length; i += 3) {
      channels.add(String(insert!.params[i]))
    }
    expect(channels).toEqual(new Set(['in_app', 'email', 'sms']))
  })

  it('does not insert already-elapsed offsets for a short due period', async () => {
    const issuedAt = new Date('2026-09-05T12:00:00.000Z')
    const row = unpaidCandidate('inv-short', { issued_at: issuedAt })
    const db = makeFakeDb(defaultHandler([row]))
    const result = await scheduleIssuedInvoiceReminders(
      scheduleOptions(db, { now: issuedAt }),
    )
    expect(result.scheduled).toBe(1)
    const insert = db.calls.find((c) => c.sql.includes('INSERT INTO invoice_reminder_schedule'))
    expect(insertedOffsets(insert!.params)).toEqual([-1, 0, 1, 7])
  })

  it('does not insert stale offsets when the worker processes the invoice days late', async () => {
    const now = new Date('2026-09-05T12:00:00.000Z')
    const db = makeFakeDb(defaultHandler())
    const result = await scheduleIssuedInvoiceReminders(scheduleOptions(db, { now }))
    expect(result.scheduled).toBe(1)
    const insert = db.calls.find((c) => c.sql.includes('INSERT INTO invoice_reminder_schedule'))
    expect(insertedOffsets(insert!.params)).toEqual([-1, 0, 1, 7])
  })

  it('skips insert when every offset has already elapsed', async () => {
    const now = new Date('2026-09-20T12:00:00.000Z')
    const db = makeFakeDb(defaultHandler())
    const result = await scheduleIssuedInvoiceReminders(scheduleOptions(db, { now }))
    expect(result).toMatchObject({ scanned: 1, scheduled: 0, skipped: 1, errors: [] })
    expect(db.calls.some((c) => c.sql.includes('INSERT INTO invoice_reminder_schedule'))).toBe(
      false,
    )
  })

  it('skips a candidate that is no longer eligible after the row lock', async () => {
    const candidate = unpaidCandidate()
    const db = makeFakeDb(
      defaultHandler([candidate], [{ ...candidate, state: 'Paid' }]),
    )
    const result = await scheduleIssuedInvoiceReminders(scheduleOptions(db))
    expect(result).toMatchObject({ scanned: 1, scheduled: 0, skipped: 1, errors: [] })
    expect(db.calls.some((c) => c.sql.includes('INSERT INTO invoice_reminder_schedule'))).toBe(
      false,
    )
    expect(db.calls.some((c) => c.sql === 'ROLLBACK')).toBe(true)
  })

  it('skips when schedule rows already exist under lock (idempotent re-run)', async () => {
    const db = makeFakeDb(defaultHandler([unpaidCandidate()], 'match', 1))
    const result = await scheduleIssuedInvoiceReminders(scheduleOptions(db))
    expect(result).toMatchObject({ scanned: 1, scheduled: 0, skipped: 1 })
    expect(db.calls.some((c) => c.sql.includes('INSERT INTO invoice_reminder_schedule'))).toBe(
      false,
    )
  })

  it('skips when FOR UPDATE SKIP LOCKED returns no row (held by a concurrent worker)', async () => {
    const db = makeFakeDb(defaultHandler([unpaidCandidate()], []))
    const result = await scheduleIssuedInvoiceReminders(scheduleOptions(db))
    expect(result).toMatchObject({ scanned: 1, scheduled: 0, skipped: 1 })
    expect(db.calls.some((c) => c.sql.includes('INSERT INTO invoice_reminder_schedule'))).toBe(
      false,
    )
  })

  it('isolates a per-invoice failure and continues the batch', async () => {
    const rows = [unpaidCandidate('inv-ok'), unpaidCandidate('inv-boom')]
    const db = makeFakeDb((sql, params) => {
      if (sql.includes('NOT EXISTS')) return { rows }
      if (sql.includes('FOR UPDATE OF i SKIP LOCKED')) {
        return { rows: [rows.find((r) => r.id === params[0])!] }
      }
      if (sql.includes('FROM invoice_reminder_schedule WHERE invoice_id')) {
        return { rows: [], rowCount: 0 }
      }
      if (sql.includes('INSERT INTO invoice_reminder_schedule')) {
        if (params[0] === 'inv-boom') throw new Error('deadlock')
        return { rows: [], rowCount: 6 }
      }
      return { rows: [] }
    })

    const result = await scheduleIssuedInvoiceReminders(scheduleOptions(db))
    expect(result.scheduled).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('inv-boom')
    expect(result.errors[0]).toContain('deadlock')
  })

  it('sets truncated when the candidate query fills the batch cap', async () => {
    const rows = [unpaidCandidate('inv-0'), unpaidCandidate('inv-1')]
    const db = makeFakeDb(defaultHandler(rows))
    const result = await scheduleIssuedInvoiceReminders(
      scheduleOptions(db, { batchSize: 2 }),
    )
    expect(result.truncated).toBe(true)
    expect(result.scanned).toBe(2)
    expect(result.scheduled).toBe(2)
  })

  it('pages past a full batch of elapsed-offset invoices and schedules a newer issue', async () => {
    const staleDue = new Date('2026-01-01T12:00:00.000Z')
    const staleIssued = new Date('2025-12-25T12:00:00.000Z')
    const stale = Array.from({ length: 5 }, (_, index) =>
      unpaidCandidate(`11111111-1111-7111-8111-11111111111${index}`, {
        due_at: staleDue,
        issued_at: new Date(staleIssued.getTime() + index),
      }),
    )
    const fresh = unpaidCandidate('22222222-2222-7222-8222-222222222222')
    const byId = new Map([...stale, fresh].map((row) => [row.id, row]))

    const db = makeFakeDb((sql, params) => {
      if (sql.includes('FROM invoices i') && sql.includes('NOT EXISTS')) {
        const afterId = params[4]
        if (afterId == null) return { rows: stale }
        return { rows: [fresh] }
      }
      if (sql.includes('FOR UPDATE OF i SKIP LOCKED')) {
        const row = byId.get(String(params[0]))
        return { rows: row ? [row] : [] }
      }
      if (sql.includes('FROM invoice_reminder_schedule WHERE invoice_id')) {
        return { rows: [], rowCount: 0 }
      }
      if (sql.includes('INSERT INTO invoice_reminder_schedule')) {
        return { rows: [], rowCount: 6 }
      }
      return { rows: [] }
    })

    const result = await scheduleIssuedInvoiceReminders(
      scheduleOptions(db, { batchSize: 5, now: ISSUED }),
    )

    expect(result).toMatchObject({
      scanned: 6,
      scheduled: 1,
      skipped: 5,
      truncated: false,
      errors: [],
    })
    const insert = db.calls.find((c) => c.sql.includes('INSERT INTO invoice_reminder_schedule'))
    expect(insert?.params[0]).toBe(fresh.id)
    const findCalls = db.calls.filter((c) => c.sql.includes('NOT EXISTS'))
    expect(findCalls).toHaveLength(2)
    expect(findCalls[1]?.params[4]).toBe(stale[stale.length - 1]?.id)
  })

  it('locks each candidate with FOR UPDATE OF i SKIP LOCKED', async () => {
    const db = makeFakeDb(defaultHandler())
    await scheduleIssuedInvoiceReminders(scheduleOptions(db))
    const lock = db.calls.find((c) => c.sql.includes('FOR UPDATE OF i SKIP LOCKED'))
    expect(lock!.params).toEqual(['inv-unpaid'])
  })

  it('is a no-op when every issued invoice already has a schedule', async () => {
    const db = makeFakeDb(defaultHandler([]))
    const result = await scheduleIssuedInvoiceReminders(scheduleOptions(db))
    expect(result).toMatchObject({
      scanned: 0,
      scheduled: 0,
      skipped: 0,
      truncated: false,
      errors: [],
    })
    expect(db.pool.connect).not.toHaveBeenCalled()
  })

  it('does not insert schedule rows when the delivery-window config query fails', async () => {
    const db = makeFakeDb((sql) => {
      if (sql.includes('app_config')) throw new Error('connection reset')
      return defaultHandler()(sql)
    })
    const logger = { warn: vi.fn(), info: vi.fn() }

    await expect(
      scheduleIssuedInvoiceReminders({
        pool: db.pool as unknown as Pool,
        logger,
      }),
    ).rejects.toThrow('connection reset')

    expect(db.calls.some((c) => c.sql.includes('INSERT INTO invoice_reminder_schedule'))).toBe(
      false,
    )
    expect(db.pool.connect).not.toHaveBeenCalled()
  })

  it('does not insert schedule rows when the offset-toggle query fails', async () => {
    const db = makeFakeDb((sql) => {
      if (sql.includes('invoice_reminder_offset_toggles')) throw new Error('toggles unavailable')
      return defaultHandler()(sql)
    })
    const logger = { warn: vi.fn(), info: vi.fn() }

    await expect(
      scheduleIssuedInvoiceReminders(scheduleOptions(db, { logger })),
    ).rejects.toThrow('toggles unavailable')

    expect(db.calls.some((c) => c.sql.includes('INSERT INTO invoice_reminder_schedule'))).toBe(
      false,
    )
    expect(db.pool.connect).not.toHaveBeenCalled()
  })

  it('still schedules when app_config has no delivery-window entry', async () => {
    const db = makeFakeDb((sql) => {
      if (sql.includes('app_config')) return { rows: [] }
      return defaultHandler()(sql)
    })
    const result = await scheduleIssuedInvoiceReminders({
      pool: db.pool as unknown as Pool,
      logger: { warn: vi.fn(), info: vi.fn() },
      now: ISSUED,
    })
    expect(result.scheduled).toBe(1)
    expect(db.calls.some((c) => c.sql.includes('INSERT INTO invoice_reminder_schedule'))).toBe(
      true,
    )
  })
})
