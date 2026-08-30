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
import {
  DEFAULT_DELIVERY_WINDOW,
  isWithinWindow,
  loadDeliveryWindowConfig,
  nextWindowOpen,
} from '../notifications/delivery-window.js'

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
 *   3. Insert `in_app` always, plus `email`/`sms` when those channels
 *      are enabled on `users.notification_preferences`.
 *
 * Admin per-offset toggles (T-04.1.04.05) and the unique
 * (invoiceId, offset, channel) index (T-04.1.04.04) are later tasks;
 * this pass inserts the full canonical offset set and is idempotent by
 * skipping invoices that already have any schedule row (re-checked
 * under `FOR UPDATE SKIP LOCKED`).
 *
 * Stop states (Paid / Cancelled / Refunded) are not scheduled; cancelling
 * already-inserted future rows is T-04.1.04.06.
 */

/** Default number of issued invoices claimed per tick. */
export const DEFAULT_REMINDER_SCHEDULE_BATCH_SIZE = 200

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
   * invoice was no longer eligible after lock, or rows already existed.
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
 * Build the schedule rows for one invoice: canonical offsets × enabled
 * channels, with daytime-window snapping applied to every `scheduledAt`.
 */
export function planInvoiceReminders(input: {
  dueAt: Date
  channels: readonly InvoiceReminderChannel[]
  window: DeliveryWindowConfig
}): PlannedReminderRow[] {
  const channels: InvoiceReminderChannel[] =
    input.channels.length > 0 ? [...input.channels] : ['in_app']
  const rows: PlannedReminderRow[] = []
  for (const { offset, instant } of computeReminderInstants(input.dueAt)) {
    const scheduledAt = snapToDaytimeWindow(instant, input.window)
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

async function loadWindow(
  pool: Pool,
  override: DeliveryWindowConfig | undefined,
): Promise<DeliveryWindowConfig> {
  if (override) return override
  try {
    return await loadDeliveryWindowConfig(pool)
  } catch {
    return { ...DEFAULT_DELIVERY_WINDOW }
  }
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
      const inserted = await scheduleOneInvoice(client, candidate, adminWindow)
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
): Promise<boolean> {
  const locked = await client.query<CandidateRow>(LOCK_INVOICE_SQL, [candidate.id])
  const row = locked.rows[0]
  if (!row) return false
  if (!isEligibleForReminderSchedule(row.state, row.issued_at, row.due_at)) return false

  const existing = await client.query(EXISTING_SCHEDULE_SQL, [row.id])
  if ((existing.rowCount ?? existing.rows.length) > 0) return false

  const dueAt = parseDueAtValue(row.due_at)
  if (dueAt === null) return false

  const window = reminderWindowForProfile(adminWindow, row.timezone)
  const channels = reminderChannelsFromPreferences(row.notification_preferences)
  const planned = planInvoiceReminders({ dueAt, channels, window })
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
