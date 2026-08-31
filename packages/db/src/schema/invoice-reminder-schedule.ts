import { sql } from 'drizzle-orm'
import { integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { baseColumns } from '../base-table'
import { timestamptz, uuidv7 } from '../types'
import { invoices } from './invoices'

/**
 * Canonical reminder offsets in days relative to `invoices.due_at`
 * (S-04.1.04): 7/3/1 days before, on due, 1 and 7 days after.
 *
 * Must stay in lock-step with `@barghsa/shared/finance` INVOICE_REMINDER_OFFSETS
 * (T-04.1.04.02) and `chk_invoice_reminder_schedule_offset` in migration 0060.
 */
export const INVOICE_REMINDER_OFFSETS = [-7, -3, -1, 0, 1, 7] as const
export type InvoiceReminderOffset = (typeof INVOICE_REMINDER_OFFSETS)[number]

/**
 * Delivery channels for a scheduled reminder. Matches the notification
 * transport set (`in_app` always; `email`/`sms` per profile preferences).
 */
export const INVOICE_REMINDER_CHANNELS = ['in_app', 'email', 'sms'] as const
export type InvoiceReminderChannel = (typeof INVOICE_REMINDER_CHANNELS)[number]

/**
 * Lifecycle of one schedule row.
 *
 * - `scheduled` — waiting for ReminderSender (T-04.1.04.03)
 * - `sent` — dispatched via the notification outbox; `sent_at` is set
 * - `cancelled` — stopped because the invoice reached Paid/Cancelled/Refunded
 *   (T-04.1.04.06; trigger `trg_cancel_invoice_reminders_on_stop_state`)
 */
export const INVOICE_REMINDER_STATUSES = ['scheduled', 'sent', 'cancelled'] as const
export type InvoiceReminderStatus = (typeof INVOICE_REMINDER_STATUSES)[number]

/**
 * Invoice reminder schedule (T-04.1.04.01).
 *
 * One row is ONE planned reminder for a single invoice on a single
 * channel at a single offset from `due_at`. ReminderScheduler
 * (T-04.1.04.02) inserts rows when an invoice is issued; ReminderSender
 * (T-04.1.04.03) claims due `scheduled` rows and writes `sent_at`.
 *
 * Columns (S-04.1.04 / T-04.1.04.01):
 *   - `invoiceId` — FK → invoices.id (CASCADE)
 *   - `offset` — days relative to `due_at`; CHECK the canonical set
 *   - `channel` — `in_app` | `email` | `sms`
 *   - `scheduledAt` — when the reminder becomes eligible (daytime window
 *     applied by the scheduler)
 *   - `sentAt?` — when it was actually dispatched; null until `sent`
 *   - `status` — `scheduled` | `sent` | `cancelled`
 *
 * The migration (0060) also declares:
 *   - offset / channel / status CHECKs;
 *   - sent_at is NOT NULL iff status = 'sent';
 *   - lookup indexes on invoice_id and due (scheduled_at WHERE scheduled);
 *   - the `updated_at` trigger.
 *
 * Idempotency unique index on (invoice_id, offset, channel) is T-04.1.04.04
 * (migration 0061). Cancelling remaining `scheduled` rows when the invoice
 * enters Paid/Cancelled/Refunded is T-04.1.04.06 (migration 0063).
 */
export const invoiceReminderSchedule = pgTable(
  'invoice_reminder_schedule',
  {
    ...baseColumns,

    /** Invoice this reminder belongs to; deleting the invoice drops its schedule. */
    invoiceId: uuidv7('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),

    /**
     * Days relative to `due_at` (negative = before). SQL column is `"offset"`
     * (quoted: OFFSET is reserved). CHECK the canonical S-04.1.04 set.
     */
    offset: integer('offset').notNull(),

    /** Target channel for this row (one row per invoice/offset/channel). */
    channel: text('channel', {
      enum: INVOICE_REMINDER_CHANNELS,
    }).notNull(),

    /** When this reminder becomes eligible for dispatch. */
    scheduledAt: timestamptz('scheduled_at').notNull(),

    /** When the reminder was dispatched; null until status is `sent`. */
    sentAt: timestamptz('sent_at'),

    /** Lifecycle status. Default `scheduled`. */
    status: text('status', {
      enum: INVOICE_REMINDER_STATUSES,
    })
      .notNull()
      .default('scheduled'),
  },
  (table) => ({
    /**
     * Same reminder never planned twice (S-04.1.04 / T-04.1.04.04).
     * Created by migration 0061.
     */
    invoiceOffsetChannelUnique: uniqueIndex(
      'uq_invoice_reminder_schedule_invoice_offset_channel',
    ).on(table.invoiceId, table.offset, table.channel),
  }),
)

/** SQL to create the invoice_reminder_schedule table (migrations 0060 + 0061). */
export const createInvoiceReminderScheduleTable = sql`
  CREATE TABLE IF NOT EXISTS invoice_reminder_schedule (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    "offset" INTEGER NOT NULL
      CONSTRAINT chk_invoice_reminder_schedule_offset
        CHECK ("offset" IN (-7, -3, -1, 0, 1, 7)),
    channel TEXT NOT NULL
      CONSTRAINT chk_invoice_reminder_schedule_channel
        CHECK (channel IN ('in_app', 'email', 'sms')),
    scheduled_at TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'scheduled'
      CONSTRAINT chk_invoice_reminder_schedule_status
        CHECK (status IN ('scheduled', 'sent', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_invoice_reminder_schedule_sent_at
      CHECK (
        (status = 'sent' AND sent_at IS NOT NULL)
        OR (status <> 'sent' AND sent_at IS NULL)
      )
  );

  CREATE INDEX IF NOT EXISTS idx_invoice_reminder_schedule_invoice_id
    ON invoice_reminder_schedule (invoice_id);
  CREATE INDEX IF NOT EXISTS idx_invoice_reminder_schedule_due
    ON invoice_reminder_schedule (scheduled_at)
    WHERE status = 'scheduled';
  CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_reminder_schedule_invoice_offset_channel
    ON invoice_reminder_schedule (invoice_id, "offset", channel);

  CREATE OR REPLACE FUNCTION update_invoice_reminder_schedule_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $$
  BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
  END;
  $$;

  DROP TRIGGER IF EXISTS trg_invoice_reminder_schedule_updated_at
    ON invoice_reminder_schedule;

  CREATE TRIGGER trg_invoice_reminder_schedule_updated_at
    BEFORE UPDATE ON invoice_reminder_schedule
    FOR EACH ROW
    EXECUTE FUNCTION update_invoice_reminder_schedule_updated_at();
`

/**
 * Cancel remaining unsent (`scheduled`) reminder rows for one invoice
 * (T-04.1.04.06). Matches `cancel_future_invoice_reminders` in migration 0063.
 * Already-`sent` rows are not rewritten; `sent_at` stays NULL on cancelled rows.
 */
export const CANCEL_FUTURE_INVOICE_REMINDERS_SQL = `UPDATE invoice_reminder_schedule
        SET status = 'cancelled'
        WHERE invoice_id = $1
          AND status = 'scheduled'`
