import { sql } from 'drizzle-orm'
import { boolean, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { baseColumns } from '../base-table'
import { users } from './users'

/**
 * Admin reminder-offset toggles (T-04.1.04.05).
 *
 * One row is ONE enable/disable flag for a single canonical reminder
 * offset on a single invoice service type. Missing pairs default to
 * enabled (S-04.1.04 default schedule of -7/-3/-1/0/+1/+7).
 *
 * Canonical `service_type` keys match `service_due_periods`:
 *   `electricity` | `saving_plan` | `consultation` | `manual`
 *
 * Canonical `"offset"` values match `invoice_reminder_schedule`:
 *   `-7`, `-3`, `-1`, `0`, `1`, `7`
 *
 * The migration (0062) also declares:
 *   - service_type / offset CHECKs;
 *   - UNIQUE (service_type, offset) so upserts are deterministic;
 *   - the `updated_at` trigger.
 */
export const invoiceReminderOffsetToggles = pgTable(
  'invoice_reminder_offset_toggles',
  {
    ...baseColumns,

    /** Canonical service type (`electricity` | `saving_plan` | `consultation` | `manual`). */
    serviceType: text('service_type').notNull(),

    /**
     * Days relative to `due_at` (negative = before). SQL column is `"offset"`
     * (quoted: OFFSET is reserved). CHECK the canonical S-04.1.04 set.
     */
    offset: integer('offset').notNull(),

    /** Whether ReminderScheduler should insert this offset for this type. */
    enabled: boolean('enabled').notNull().default(true),

    /** Admin who last wrote this toggle. */
    updatedBy: text('updated_by')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
  },
  (table) => ({
    serviceTypeOffsetUnique: uniqueIndex('uq_invoice_reminder_offset_toggles_type_offset').on(
      table.serviceType,
      table.offset,
    ),
  }),
)

/** SQL to create the invoice_reminder_offset_toggles table (migration 0062 source). */
export const createInvoiceReminderOffsetTogglesTable = sql`
  CREATE TABLE IF NOT EXISTS invoice_reminder_offset_toggles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    service_type TEXT NOT NULL
      CONSTRAINT chk_invoice_reminder_offset_toggles_service_type
        CHECK (service_type IN ('electricity', 'saving_plan', 'consultation', 'manual')),
    "offset" INTEGER NOT NULL
      CONSTRAINT chk_invoice_reminder_offset_toggles_offset
        CHECK ("offset" IN (-7, -3, -1, 0, 1, 7)),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_invoice_reminder_offset_toggles_type_offset
      UNIQUE (service_type, "offset")
  );

  CREATE INDEX IF NOT EXISTS idx_invoice_reminder_offset_toggles_service_type
    ON invoice_reminder_offset_toggles (service_type);

  CREATE OR REPLACE FUNCTION update_invoice_reminder_offset_toggles_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $$
  BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
  END;
  $$;

  DROP TRIGGER IF EXISTS trg_invoice_reminder_offset_toggles_updated_at
    ON invoice_reminder_offset_toggles;

  CREATE TRIGGER trg_invoice_reminder_offset_toggles_updated_at
    BEFORE UPDATE ON invoice_reminder_offset_toggles
    FOR EACH ROW
    EXECUTE FUNCTION update_invoice_reminder_offset_toggles_updated_at();
`
