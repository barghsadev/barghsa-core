import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { getDbPool } from '@barghsa/db'
import {
  INVOICE_REMINDER_CHANNELS,
  REMINDER_STOP_STATES,
  isEligibleForReminderSend,
} from '@barghsa/shared/finance'
import type { NotificationChannel } from '@barghsa/shared/notifications'
import { enqueueOutbox, type EnqueueOutboxInput, type EnqueueOutboxResult } from '../notifications/outbox-writer.js'

/**
 * ReminderSender (S-04.1.04, T-04.1.04.03).
 *
 * Hourly worker pass that claims `invoice_reminder_schedule` rows whose
 * `scheduled_at` is due, re-checks the invoice is still allowed to be
 * reminded, and writes one notification-outbox event per
 * (invoice, offset) so in-app + enabled external channels share a single
 * durable delivery intent.
 *
 * Guarantees:
 * - **Eligibility re-check under lock.** Candidates exclude Paid /
 *   Cancelled / Refunded at query time, then the invoice is re-locked
 *   with `FOR UPDATE SKIP LOCKED` so a concurrent payment or cancel
 *   cannot be notified.
 * - **Atomic send.** Outbox insert and `status='sent'`/`sent_at` share
 *   one transaction; a crash cannot mark a row sent without its outbox
 *   row, or enqueue a reminder that stays `scheduled`.
 * - **Idempotent.** Outbox `idempotency_key` is
 *   sha256(`payment.invoice_reminder:{invoiceId}:{offset}`). A replay
 *   that finds a duplicate still stamps the schedule rows `sent`.
 *   Unique (invoiceId, offset, channel) is T-04.1.04.04.
 * - **Failure isolation.** One group’s failure is recorded and skipped;
 *   the rest of the batch still runs.
 * - **Bounded drain.** A full batch (`LIMIT`) sets `truncated` so the
 *   next hourly tick continues oldest-due first.
 *
 * Cancelling future rows when the invoice reaches a stop state is
 * T-04.1.04.06; this pass only skips send for those invoices.
 */

/** Default number of (invoice, offset) groups claimed per tick. */
export const DEFAULT_REMINDER_SEND_BATCH_SIZE = 200

/** Default hourly cadence (T-04.1.04.03: cron every hour). */
export const DEFAULT_REMINDER_SEND_INTERVAL_MS = 60 * 60 * 1000

/** Stable worker task key recorded in `background_jobs`. */
export const INVOICE_REMINDER_SEND_JOB_TYPE = 'invoice_reminder_sender' as const

/** Outbox event key for a payment reminder (E-05 registry). */
export const PAYMENT_INVOICE_REMINDER_EVENT_KEY = 'payment.invoice_reminder' as const

/** Outcome of one reminder-sender pass. */
export interface ReminderSendResult {
  /** Candidate (invoice, offset) groups fetched this tick. */
  scanned: number
  /** Groups that received an outbox write and were marked `sent`. */
  sent: number
  /**
   * Groups skipped because a concurrent worker held the rows, the
   * invoice was no longer eligible after lock, or no due rows remained.
   */
  skipped: number
  /** True when the candidate query hit the batch cap. */
  truncated: boolean
  /** Per-group failure messages. */
  errors: string[]
}

type EnqueueFn = (client: PoolClient, input: EnqueueOutboxInput) => Promise<EnqueueOutboxResult>

/** Behavioural override hooks for tests. */
export interface ReminderSendOptions {
  pool?: Pool
  logger?: { warn: (msg: string) => void; info: (msg: string) => void }
  batchSize?: number
  /** Stable send-pass timestamp. Production leaves this unset. */
  now?: Date
  /** Outbox-enqueue override for tests; defaults to {@link enqueueOutbox}. */
  enqueue?: EnqueueFn
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
 * Candidate selector: one row per due (invoice, offset) whose invoice
 * is not in a stop state. `invoices.state` is PostgreSQL type
 * `invoice_state`; bind the stop-state array as `invoice_state[]`.
 *
 * `$1` = pass `now`, `$2` = stop states, `$3` = batch size.
 */
export const FIND_DUE_REMINDER_GROUPS_SQL = `SELECT s.invoice_id, s."offset",
               MIN(s.scheduled_at) AS scheduled_at
        FROM invoice_reminder_schedule s
        JOIN invoices i ON i.id = s.invoice_id
        WHERE s.status = 'scheduled'
          AND s.scheduled_at <= $1
          AND NOT (i.state = ANY($2::invoice_state[]))
        GROUP BY s.invoice_id, s."offset"
        ORDER BY MIN(s.scheduled_at) ASC, s.invoice_id ASC, s."offset" ASC
        LIMIT $3`

const LOCK_DUE_ROWS_SQL = `SELECT id, invoice_id, "offset", channel, scheduled_at, status
        FROM invoice_reminder_schedule
        WHERE invoice_id = $1
          AND "offset" = $2
          AND status = 'scheduled'
          AND scheduled_at <= $3
        FOR UPDATE SKIP LOCKED`

const LOCK_INVOICE_SQL = `SELECT i.id, i.state, i.profile_id, i.due_at, p.user_id
        FROM invoices i
        LEFT JOIN profiles p ON p.id = i.profile_id
        WHERE i.id = $1
        FOR UPDATE OF i SKIP LOCKED`

const MARK_SENT_SQL = `UPDATE invoice_reminder_schedule
        SET status = 'sent',
            sent_at = $2
        WHERE id = ANY($1::uuid[])
          AND status = 'scheduled'`

interface GroupRow {
  invoice_id: string
  offset: number
  scheduled_at: Date | string
}

interface ScheduleRow {
  id: string
  invoice_id: string
  offset: number
  channel: string
  scheduled_at: Date | string
  status: string
}

interface InvoiceRow {
  id: string
  state: string
  profile_id: string | null
  due_at: Date | string | null
  user_id: string | null
}

/** Stable outbox idempotency key for one (invoice, offset) reminder. */
export function reminderOutboxIdempotencyKey(invoiceId: string, offset: number): string {
  return createHash('sha256').update(`${PAYMENT_INVOICE_REMINDER_EVENT_KEY}:${invoiceId}:${offset}`).digest('hex')
}

/**
 * Order due channels as in-app first, then email, then sms. Outbox
 * delivery requires `in_app`; if a leftover group has only external
 * channels, in-app is prepended so the write pipeline can accept it.
 */
export function channelsForOutbox(raw: readonly string[]): NotificationChannel[] {
  const set = new Set(raw)
  const ordered = INVOICE_REMINDER_CHANNELS.filter((channel) => set.has(channel))
  if (ordered.length === 0) return ['in_app']
  if (!ordered.includes('in_app')) return ['in_app', ...ordered]
  return [...ordered]
}

function parseInstant(value: Date | string | null | undefined): Date | null {
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
 * Run one reminder-send pass over due `scheduled` rows whose invoices
 * are still eligible.
 */
export async function sendDueInvoiceReminders(
  options: ReminderSendOptions = {},
): Promise<ReminderSendResult> {
  const pool = options.pool ?? getDbPool()
  const logger = options.logger ?? defaultLogger
  const batchSize = options.batchSize ?? DEFAULT_REMINDER_SEND_BATCH_SIZE
  const now = parseInstant(options.now ?? new Date()) ?? new Date()
  const enqueue = options.enqueue ?? enqueueOutbox

  const result: ReminderSendResult = {
    scanned: 0,
    sent: 0,
    skipped: 0,
    truncated: false,
    errors: [],
  }

  const candidates = await pool.query<GroupRow>(FIND_DUE_REMINDER_GROUPS_SQL, [
    now,
    [...REMINDER_STOP_STATES],
    batchSize,
  ])
  result.scanned = candidates.rows.length
  if (candidates.rows.length >= batchSize) {
    result.truncated = true
  }

  for (const group of candidates.rows) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const sent = await sendOneGroup(client, group, now, enqueue)
      if (sent) {
        await client.query('COMMIT')
        result.sent += 1
      } else {
        await client.query('ROLLBACK')
        result.skipped += 1
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      const message = `${group.invoice_id}@${group.offset}: ${(error as Error)?.message ?? String(error)}`
      result.errors.push(message)
      logger.warn(`Reminder send failed: ${message}`)
    } finally {
      client.release()
    }
  }

  return result
}

async function sendOneGroup(
  client: PoolClient,
  group: GroupRow,
  now: Date,
  enqueue: EnqueueFn,
): Promise<boolean> {
  const lockedInvoice = await client.query<InvoiceRow>(LOCK_INVOICE_SQL, [group.invoice_id])
  const invoice = lockedInvoice.rows[0]
  if (!invoice) return false
  if (!isEligibleForReminderSend(invoice.state)) return false
  if (invoice.profile_id === null || invoice.profile_id === '') return false

  const lockedRows = await client.query<ScheduleRow>(LOCK_DUE_ROWS_SQL, [
    group.invoice_id,
    group.offset,
    now,
  ])
  if (lockedRows.rows.length === 0) return false

  const channels = channelsForOutbox(lockedRows.rows.map((row) => row.channel))
  const earliest = lockedRows.rows.reduce<Date | null>((acc, row) => {
    const at = parseInstant(row.scheduled_at)
    if (at === null) return acc
    if (acc === null || at.getTime() < acc.getTime()) return at
    return acc
  }, parseInstant(group.scheduled_at))

  const dueAt = parseInstant(invoice.due_at)
  await enqueue(client, {
    profileId: invoice.profile_id,
    userId: invoice.user_id,
    eventKey: PAYMENT_INVOICE_REMINDER_EVENT_KEY,
    payload: {
      invoiceId: invoice.id,
      offset: group.offset,
      dueAt: dueAt?.toISOString() ?? null,
      scheduledAt: earliest?.toISOString() ?? now.toISOString(),
    },
    channels,
    idempotencyKey: reminderOutboxIdempotencyKey(invoice.id, group.offset),
    status: 'queued',
  })

  const ids = lockedRows.rows.map((row) => row.id)
  const updated = await client.query(MARK_SENT_SQL, [ids, now])
  if ((updated.rowCount ?? 0) !== ids.length) return false

  return true
}
