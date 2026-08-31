/**
 * Invoice payment-reminder schedule (T-04.1.04.02 / S-04.1.04).
 *
 * Canonical offsets are days relative to `invoices.due_at`: 7/3/1 days
 * before due, on due, and 1/7 days after. Instants use exact 24-hour UTC
 * offsets (same arithmetic as `dueAt`) so a given `dueAt` always produces
 * the same reminder clock times regardless of locale.
 *
 * The worker (ReminderScheduler) applies the daytime delivery window to
 * those instants and inserts `invoice_reminder_schedule` rows. This module
 * is the source of truth for offsets, channel tokens, and eligibility so
 * the worker and the table CHECK cannot silently drift.
 *
 * @module finance
 */

import { MS_PER_DUE_DAY } from './due-at.js'
import { parseDueAt } from './overdue.js'

/**
 * Canonical reminder offsets in days relative to `dueAt`
 * (S-04.1.04). Must stay in lock-step with
 * `chk_invoice_reminder_schedule_offset` (migration 0060).
 */
export const INVOICE_REMINDER_OFFSETS = [-7, -3, -1, 0, 1, 7] as const

/** One canonical reminder offset. */
export type InvoiceReminderOffset = (typeof INVOICE_REMINDER_OFFSETS)[number]

/**
 * Delivery channels stored on a schedule row. Matches the notification
 * transport set (`in_app` always; `email`/`sms` per profile preferences).
 */
export const INVOICE_REMINDER_CHANNELS = ['in_app', 'email', 'sms'] as const

/** One reminder delivery channel. */
export type InvoiceReminderChannel = (typeof INVOICE_REMINDER_CHANNELS)[number]

/**
 * Invoice states that must not receive a new reminder plan (S-04.1.04
 * "stop immediately"). T-04.1.04.06 later cancels already-inserted rows
 * on these transitions; the scheduler also skips them on catch-up.
 */
export const REMINDER_STOP_STATES = ['Paid', 'Cancelled', 'Refunded'] as const

/** An invoice state that must not receive a new reminder schedule. */
export type ReminderStopState = (typeof REMINDER_STOP_STATES)[number]

/** Error messages for reminder instant arithmetic. */
export const REMINDER_SCHEDULE_ERRORS = {
  BAD_DUE_AT: () => 'dueAt must be a valid Date',
  BAD_OFFSET: () => 'offsetDays must be an integer',
} as const

/** True when `value` is one of the canonical S-04.1.04 offsets. */
export function isInvoiceReminderOffset(value: number): value is InvoiceReminderOffset {
  return (INVOICE_REMINDER_OFFSETS as readonly number[]).includes(value)
}

/** True when `state` is Paid / Cancelled / Refunded. */
export function isReminderStopState(state: string): state is ReminderStopState {
  return (REMINDER_STOP_STATES as readonly string[]).includes(state)
}

/**
 * Add `offsetDays` exact 24-hour periods to `dueAt` (negative = before).
 *
 * @throws RangeError when `dueAt` is invalid or `offsetDays` is not an integer.
 */
export function addReminderOffset(dueAt: Date, offsetDays: number): Date {
  if (!(dueAt instanceof Date) || Number.isNaN(dueAt.getTime())) {
    throw new RangeError(REMINDER_SCHEDULE_ERRORS.BAD_DUE_AT())
  }
  if (!Number.isInteger(offsetDays)) {
    throw new RangeError(REMINDER_SCHEDULE_ERRORS.BAD_OFFSET())
  }
  return new Date(dueAt.getTime() + offsetDays * MS_PER_DUE_DAY)
}

/**
 * Compute the six canonical reminder instants from `dueAt`.
 * Daytime-window snapping is applied by the worker, not here.
 */
export function computeReminderInstants(dueAt: Date): Array<{
  offset: InvoiceReminderOffset
  instant: Date
}> {
  return INVOICE_REMINDER_OFFSETS.map((offset) => ({
    offset,
    instant: addReminderOffset(dueAt, offset),
  }))
}

/**
 * True when an issued invoice may receive a reminder plan: it has a
 * valid `issuedAt` and `dueAt`, and has not reached a stop state.
 */
export function isEligibleForReminderSchedule(
  state: string,
  issuedAt: Date | string | null | undefined,
  dueAt: Date | string | null | undefined,
): boolean {
  if (isReminderStopState(state)) return false
  if (state === 'Draft') return false
  return parseDueAt(issuedAt) !== null && parseDueAt(dueAt) !== null
}

/**
 * True when ReminderSender (T-04.1.04.03) may dispatch a due schedule
 * row: the invoice is not Draft and has not reached Paid / Cancelled /
 * Refunded. Overdue and in-flight payment states stay eligible so the
 * hourly cron can still send.
 */
export function isEligibleForReminderSend(state: string): boolean {
  if (state === 'Draft') return false
  return !isReminderStopState(state)
}

/**
 * Map `users.notification_preferences` (`IN_APP,EMAIL,SMS`) onto schedule
 * channel tokens. `in_app` is always included (S-04.1.04: reminders are
 * always sent in-app plus any enabled external channel).
 */
export function reminderChannelsFromPreferences(
  raw: string | null | undefined,
): InvoiceReminderChannel[] {
  const tokens = new Set(
    (raw ?? '')
      .split(',')
      .map((token) => token.trim().toUpperCase())
      .filter((token) => token.length > 0),
  )
  const channels: InvoiceReminderChannel[] = ['in_app']
  if (tokens.has('EMAIL')) channels.push('email')
  if (tokens.has('SMS')) channels.push('sms')
  return channels
}
