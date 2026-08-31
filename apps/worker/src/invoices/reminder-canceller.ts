import type { Pool, PoolClient } from 'pg'
import { getDbPool } from '@barghsa/db'
import { REMINDER_STOP_STATES, isReminderStopState } from '@barghsa/shared/finance'

/**
 * Cancel remaining unsent reminder rows (T-04.1.04.06 / S-04.1.04).
 *
 * Production stop-on-Paid/Cancelled/Refunded is the invoices-state trigger
 * in migration 0063. This module is the same UPDATE for:
 *   - ReminderSender catch-up when a concurrent payment wins the race
 *     after the candidate query (COMMIT the cancel instead of rolling
 *     back a no-op skip);
 *   - tests and any explicit catch-up pass.
 *
 * "Future" means remaining `scheduled` rows — unsent plan, including
 * already-due rows the sender has not claimed. `sent` rows stay `sent`.
 */

/** Single-invoice cancel. `$1` = invoice id. */
export const CANCEL_FUTURE_INVOICE_REMINDERS_SQL = `UPDATE invoice_reminder_schedule
        SET status = 'cancelled'
        WHERE invoice_id = $1
          AND status = 'scheduled'`

/**
 * Catch-up for invoices already in a stop state that still have
 * `scheduled` rows (pre-trigger leftovers, or a missed trigger).
 * `$1` = stop-state array bound as `invoice_state[]`.
 */
export const CANCEL_SCHEDULED_REMINDERS_FOR_STOP_STATES_SQL = `UPDATE invoice_reminder_schedule AS s
        SET status = 'cancelled'
        FROM invoices AS i
        WHERE s.invoice_id = i.id
          AND s.status = 'scheduled'
          AND i.state = ANY($1::invoice_state[])`

export interface CancelRemindersResult {
  /** Rows rewritten from `scheduled` to `cancelled`. */
  cancelled: number
}

type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>

/**
 * Mark every remaining `scheduled` row for `invoiceId` as `cancelled`.
 * Idempotent: already-cancelled / sent rows are untouched.
 */
export async function cancelFutureInvoiceReminders(
  client: Queryable,
  invoiceId: string,
): Promise<CancelRemindersResult> {
  const result = await client.query(CANCEL_FUTURE_INVOICE_REMINDERS_SQL, [invoiceId])
  return { cancelled: result.rowCount ?? 0 }
}

/**
 * When `state` is Paid / Cancelled / Refunded, cancel remaining scheduled
 * rows for `invoiceId` and return true so the caller COMMITs. Other
 * ineligible states return false (caller rolls back a no-op skip).
 */
export async function cancelRemindersIfStopState(
  client: Queryable,
  invoiceId: string,
  state: string,
): Promise<boolean> {
  if (!isReminderStopState(state)) return false
  await cancelFutureInvoiceReminders(client, invoiceId)
  return true
}

/**
 * Catch-up pass: cancel leftover `scheduled` rows whose invoices already
 * sit in a stop state. Migration 0063 runs the same UPDATE once; this is
 * the application-level equivalent.
 */
export async function cancelScheduledRemindersForStoppedInvoices(
  options: { pool?: Pool } = {},
): Promise<CancelRemindersResult> {
  const pool = options.pool ?? getDbPool()
  const result = await pool.query(CANCEL_SCHEDULED_REMINDERS_FOR_STOP_STATES_SQL, [
    [...REMINDER_STOP_STATES],
  ])
  return { cancelled: result.rowCount ?? 0 }
}
