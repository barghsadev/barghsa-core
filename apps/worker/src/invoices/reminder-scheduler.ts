import type { Pool, PoolClient } from 'pg'
import { getDbPool } from '@barghsa/db'
import {
  REMINDER_STOP_STATES,
  computeReminderInstants,
  isEligibleForReminderSchedule,
  reminderChannelsFromPreferences,
  type InvoiceReminderChannel,
  type InvoiceReminderOffset,
} from '@barghsa/shared/finance'
import { isValidTimeZone, type DeliveryWindowConfig } from '@barghsa/shared/notifications'
import { isWithinWindow, loadDeliveryWindowConfig, nextWindowOpen } from '../notifications/delivery-window.js'

/**
 * ReminderScheduler (S-04.1.04, T-04.1.04.02).
 *
 * Periodic worker pass that finds invoices that have already been issued
 * (`issued_at` and `due_at` set) and still have no
 * `invoice_reminder_schedule` rows, then inserts one row per
 * (offset, channel).
 *
 * "On invoice issue" is implemented as a catch-up poll so every issue
 * path (manual, auto, future origins) is covered without coupling the
 * API transaction to the worker. A typical tick is 60s, so a newly
 * issued invoice is scheduled on the next pass.
 *
 * For each invoice:
 *   1. `scheduledAt = dueAt + offset` (exact 24-hour UTC days).
 *   2. Snap that instant into the daytime delivery window (09:00–21:00
 *      by default) in the **profile owner's timezone**, using the admin
 *      window hours from `app_config` when present.
 *   3. Omit elapsed offsets (see catch-up policy below) so ReminderSender
 *      cannot claim a stack of already-due rows right after issue.
 *   4. Insert `in_app` always, plus `email`/`sms` when those channels
 *      are enabled on `users.notification_preferences`.
 *
 * Catch-up policy: queue an offset only when its unsnapped instant is
 * on or after `issuedAt` and its snapped `scheduledAt` is on or after
 * `max(issuedAt, now - REMINDER_SCHEDULE_CATCH_UP_GRACE_MS)`. Offsets
 * that predate issuance (short due period) or that elapsed before this
 * pass (delayed poll) are dropped, not backfilled. The grace covers the
 * 60s catch-up poll so the on-issue `-7` offset of a default 7-day due
 * period is not discarded as stale.
 *
 * Admin per-offset toggles (T-04.1.04.05) and the unique
 * (invoiceId, offset, channel) index (T-04.1.04.04) are later tasks;
 * this pass inserts remaining future offsets and is idempotent by
 * skipping invoices that already have any schedule row (re-checked
 * under `FOR UPDATE SKIP LOCKED`).
 *
 * Stop states (Paid / Cancelled / Refunded) are not scheduled; cancelling
 * already-inserted future rows is T-04.1.04.06.
 */

/** Default number of issued invoices claimed per tick. */
export const DEFAULT_REMINDER_SCHEDULE_BATCH_SIZE = 200

/**
 * Offsets whose snapped `scheduledAt` is this close to the scheduling
 * pass are still queued. Matches the 60s catch-up poll (and leaves slack
 * for a slow batch) so a default 7-day due period still gets its `-7`
 * on-issue reminder; hours- or days-late processing does not.
 */
export const REMINDER_SCHEDULE_CATCH_UP_GRACE_MS = 60 * 60 * 1000

/** Stable worker task key recorded in `background_jobs`. */
export const INVOICE_REMINDER_JOB_TYPE = 'invoice_reminder_scheduler' as const

/** Outcome of one reminder-scheduler pass. */
export interface ReminderScheduleResult {
  /** Candidate invoices fetched this tick (before per-row lock/re-check). */
  scanned: number
  /** Invoices that received a new schedule. */
  scheduled: number
  /**
   * Candidates skipped because a concurrent worker held the row, the
   * invoice was no longer eligible after lock, rows already existed,
   * or every offset had already elapsed.
   */
  skipped: number
  /** True when the candidate query hit the batch cap. */
  truncated: boolean
  /** Per-invoice failure messages. */
  errors: string[]
}

/** One planned schedule row (offset × channel). */
export interface PlannedReminderRow {
  offset: InvoiceReminderOffset
  channel: InvoiceReminderChannel
  scheduledAt: Date
}

/** Behavioural override hooks for tests. */
export interface ReminderScheduleOptions {
  pool?: Pool
  logger?: { warn: (msg: string) => void; info: (msg: string) => void }
  batchSize?: number
  /**
   * Delivery window. When set, `app_config` is not queried (unit tests).
   * Production leaves this unset so the admin-configured window is used.
   */
  deliveryWindow?: DeliveryWindowConfig
  /**
   * Stable scheduling-pass timestamp used to drop elapsed offsets.
   * Production leaves this unset (`new Date()` once per pass).
   */
  now?: Date
}

const defaultLogger = {
  warn: (msg: string): void => {
    // eslint-disable-next-line no-console
    console.warn(`[worker] ${msg}`)
  },
  info: (msg: string): void => {
    // eslint-disable-next-line no-console
    console.log(`[worker] ${msg}`)
  },
}

/**
 * Candidate selector. `invoices.state` is PostgreSQL type `invoice_state`;
 * bind the stop-state array as `invoice_state[]`. Skip invoices that
 * already have any schedule row so a re-run is a no-op.
 */
export const FIND_UNSCHEDULED_ISSUED_INVOICES_SQL = `SELECT i.id, i.state, i.due_at, i.issued_at,
               COALESCE(u.timezone, 'Asia/Tehran') AS timezone,
               COALESCE(u.notification_preferences, 'IN_APP') AS notification_preferences
        FROM invoices i
        LEFT JOIN profiles p ON p.id = i.profile_id
        LEFT JOIN users u ON u.user_id = p.user_id
        WHERE i.issued_at IS NOT NULL
          AND i.due_at IS NOT NULL
          AND NOT (i.state = ANY($1::invoice_state[]))
          AND NOT EXISTS (
            SELECT 1 FROM invoice_reminder_schedule s WHERE s.invoice_id = i.id
          )
        ORDER BY i.issued_at ASC, i.id ASC
        LIMIT $2`

const LOCK_INVOICE_SQL = `SELECT i.id, i.state, i.due_at, i.issued_at,
               COALESCE(u.timezone, 'Asia/Tehran') AS timezone,
               COALESCE(u.notification_preferences, 'IN_APP') AS notification_preferences
        FROM invoices i
        LEFT JOIN profiles p ON p.id = i.profile_id
        LEFT JOIN users u ON u.user_id = p.user_id
        WHERE i.id = $1
        FOR UPDATE OF i SKIP LOCKED`

const EXISTING_SCHEDULE_SQL = `SELECT 1 FROM invoice_reminder_schedule WHERE invoice_id = $1 LIMIT 1`

interface CandidateRow {
  id: string
  state: string
  due_at: Date | string | null
  issued_at: Date | string | null
  timezone: string | null
  notification_preferences: string | null
}

/**
 * Overlay the profile owner's IANA timezone onto the admin delivery-window
 * hours. Story S-04.1.04: "09:00–21:00 profile timezone". An invalid
 * timezone falls back to the admin/default zone so a bad user setting
 * cannot disable scheduling.
 */
export function reminderWindowForProfile(
  adminWindow: DeliveryWindowConfig,
  profileTimezone: string | null | undefined,
): DeliveryWindowConfig {
  const tz = typeof profileTimezone === 'string' ? profileTimezone.trim() : ''
  return {
    timezone: tz.length > 0 && isValidTimeZone(tz) ? tz : adminWindow.timezone,
    startHour: adminWindow.startHour,
    endHour: adminWindow.endHour,
  }
}

/**
 * Snap `instant` into the daytime window: unchanged when already inside,
 * otherwise the next window open in `config.timezone`.
 */
export function snapToDaytimeWindow(instant: Date, config: DeliveryWindowConfig): Date {
  if (isWithinWindow(instant, config)) return instant
  return nextWindowOpen(instant, config)
}

/**
 * Lower bound for "already elapsed" against the scheduling pass.
 * Never earlier than `issuedAt` (a reminder cannot predate the invoice).
 * `now - grace` covers catch-up poll latency without backfilling days-old
 * offsets.
 */
export function reminderElapsedCutoffMs(
  issuedAt: Date,
  now: Date,
  graceMs: number = REMINDER_SCHEDULE_CATCH_UP_GRACE_MS,
): number {
  return Math.max(issuedAt.getTime(), now.getTime() - graceMs)
}

/**
 * True when this offset must not be queued: the unsnapped instant predates
 * issuance, or the snapped send time is already behind the catch-up cutoff.
 */
export function isElapsedReminder(input: {
  instant: Date
  scheduledAt: Date
  issuedAt: Date
  now: Date
}): boolean {
  if (input.instant.getTime() < input.issuedAt.getTime()) return true
  return input.scheduledAt.getTime() < reminderElapsedCutoffMs(input.issuedAt, input.now)
}

/**
 * Build the schedule rows for one invoice: canonical offsets × enabled
 * channels, with daytime-window snapping applied to every `scheduledAt`.
 * Elapsed offsets (before `issuedAt`, or already past `now` beyond the
 * catch-up grace) are omitted so ReminderSender cannot bulk-dispatch
 * obsolete reminders.
 */
export function planInvoiceReminders(input: {
  dueAt: Date
  issuedAt: Date
  now: Date
  channels: readonly InvoiceReminderChannel[]
  window: DeliveryWindowConfig
}): PlannedReminderRow[] {
  const channels: InvoiceReminderChannel[] =
    input.channels.length > 0 ? [...input.channels] : ['in_app']
  const rows: PlannedReminderRow[] = []
  for (const { offset, instant } of computeReminderInstants(input.dueAt)) {
    const scheduledAt = snapToDaytimeWindow(instant, input.window)
    if (isElapsedReminder({ instant, scheduledAt, issuedAt: input.issuedAt, now: input.now })) {
      continue
    }
    for (const channel of channels) {
      rows.push({ offset, channel, scheduledAt })
    }
  }
  return rows
}

function parseDueAtValue(value: Date | string | null | undefined): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  return null
}

/**
 * Resolve the admin delivery window. Query errors must propagate: a
 * transient `app_config` failure must not insert durable schedule rows
 * against the default hours, because later ticks skip invoices that
 * already have rows. Missing or malformed values are already normalized
 * by `loadDeliveryWindowConfig`.
 */
async function loadWindow(
  pool: Pool,
  override: DeliveryWindowConfig | undefined,
): Promise<DeliveryWindowConfig> {
  if (override) return override
  return loadDeliveryWindowConfig(pool)
}

/**
 * Run one reminder-scheduling pass over issued invoices that still lack
 * schedule rows.
 */
export async function scheduleIssuedInvoiceReminders(
  options: ReminderScheduleOptions = {},
): Promise<ReminderScheduleResult> {
  const pool = options.pool ?? getDbPool()
  const logger = options.logger ?? defaultLogger
  const batchSize = options.batchSize ?? DEFAULT_REMINDER_SCHEDULE_BATCH_SIZE
  const now = parseDueAtValue(options.now ?? new Date()) ?? new Date()

  const result: ReminderScheduleResult = {
    scanned: 0,
    scheduled: 0,
    skipped: 0,
    truncated: false,
    errors: [],
  }

  const adminWindow = await loadWindow(pool, options.deliveryWindow)

  const candidates = await pool.query<CandidateRow>(FIND_UNSCHEDULED_ISSUED_INVOICES_SQL, [
    [...REMINDER_STOP_STATES],
    batchSize,
  ])
  result.scanned = candidates.rows.length
  if (candidates.rows.length >= batchSize) {
    result.truncated = true
  }

  for (const candidate of candidates.rows) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const inserted = await scheduleOneInvoice(client, candidate, adminWindow, now)
      if (inserted) {
        await client.query('COMMIT')
        result.scheduled += 1
      } else {
        await client.query('ROLLBACK')
        result.skipped += 1
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      const message = `${candidate.id}: ${(error as Error)?.message ?? String(error)}`
      result.errors.push(message)
      logger.warn(`Reminder schedule failed: ${message}`)
    } finally {
      client.release()
    }
  }

  return result
}

async function scheduleOneInvoice(
  client: PoolClient,
  candidate: CandidateRow,
  adminWindow: DeliveryWindowConfig,
  now: Date,
): Promise<boolean> {
  const locked = await client.query<CandidateRow>(LOCK_INVOICE_SQL, [candidate.id])
  const row = locked.rows[0]
  if (!row) return false
  if (!isEligibleForReminderSchedule(row.state, row.issued_at, row.due_at)) return false

  const existing = await client.query(EXISTING_SCHEDULE_SQL, [row.id])
  if ((existing.rowCount ?? existing.rows.length) > 0) return false

  const dueAt = parseDueAtValue(row.due_at)
  const issuedAt = parseDueAtValue(row.issued_at)
  if (dueAt === null || issuedAt === null) return false

  const window = reminderWindowForProfile(adminWindow, row.timezone)
  const channels = reminderChannelsFromPreferences(row.notification_preferences)
  const planned = planInvoiceReminders({ dueAt, issuedAt, now, channels, window })
  if (planned.length === 0) return false

  const values: unknown[] = [row.id]
  const placeholders: string[] = []
  let param = 2
  for (const item of planned) {
    placeholders.push(`($1, $${param}, $${param + 1}, $${param + 2})`)
    values.push(item.offset, item.channel, item.scheduledAt)
    param += 3
  }

  await client.query(
    `INSERT INTO invoice_reminder_schedule (invoice_id, "offset", channel, scheduled_at)
     VALUES ${placeholders.join(', ')}`,
    values,
  )

  return true
}
