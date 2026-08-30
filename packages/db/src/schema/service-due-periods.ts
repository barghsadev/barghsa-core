import { sql } from 'drizzle-orm'
import { integer, text } from 'drizzle-orm/pg-core'
import { createTable } from '../base-table'
import { timestamptz } from '../types'
import { users } from './users'

/**
 * Service due periods (T-04.1.03.01) — admin-configured default invoice
 * due days per service type.
 *
 * One row is ONE versioned period: `default_days` is the number of days
 * added to `issuedAt` to compute `dueAt` (T-04.1.03.02). Each row
 * carries an effective window (`effective_from` inclusive,
 * `effective_until` exclusive; null = open). Adding a new period for a
 * service type appends a row; a period is never mutated or hard-deleted
 * — it is end-dated instead, preserving the complete history for
 * invoice issuance.
 *
 * Canonical `service_type` keys (S-04.1.03 / `@barghsa/shared/finance`):
 *   `electricity` | `saving_plan` | `consultation` | `manual`
 *
 * The migration (0059) also declares:
 *   - service_type CHECK (canonical admin set);
 *   - default_days CHECK (1..365);
 *   - a CHECK that `effective_until` is null or after `effective_from`;
 *   - a GIST EXCLUDE constraint forbidding overlapping effective windows
 *     for the same service type (at most one open row per type);
 *   - the `updated_at` trigger.
 */
export const serviceDuePeriods = createTable('service_due_periods', {
  /** Canonical service type (`electricity` | `saving_plan` | `consultation` | `manual`). */
  serviceType: text('service_type').notNull(),

  /** Default due period in days. CHECK 1..365 in migration 0059. */
  defaultDays: integer('default_days').notNull(),

  /** Window start (inclusive). */
  effectiveFrom: timestamptz('effective_from').notNull(),

  /** Window end (exclusive); null = open/current. */
  effectiveUntil: timestamptz('effective_until'),

  /** Admin who recorded this period. */
  createdBy: text('created_by')
    .notNull()
    .references(() => users.userId, { onDelete: 'restrict' }),
})

/** SQL to create the service_due_periods table (migration 0059 source). */
export const createServiceDuePeriodsTable = sql`
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
      CREATE EXTENSION btree_gist;
    END IF;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN unique_violation THEN NULL;
  END
  $$;

  CREATE TABLE IF NOT EXISTS service_due_periods (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    service_type TEXT NOT NULL
      CONSTRAINT chk_service_due_periods_service_type
        CHECK (service_type IN ('electricity', 'saving_plan', 'consultation', 'manual')),
    default_days INTEGER NOT NULL
      CONSTRAINT chk_service_due_periods_default_days
        CHECK (default_days BETWEEN 1 AND 365),
    effective_from TIMESTAMPTZ NOT NULL,
    effective_until TIMESTAMPTZ
      CONSTRAINT chk_service_due_periods_effective_range
        CHECK (effective_until IS NULL OR effective_from < effective_until),
    created_by TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT excl_service_due_periods_no_overlap
      EXCLUDE USING GIST (
        service_type WITH =,
        tstzrange(effective_from, COALESCE(effective_until, 'infinity'::TIMESTAMPTZ), '[)') WITH &&
      )
  );

  CREATE INDEX IF NOT EXISTS idx_service_due_periods_service_type
    ON service_due_periods (service_type);
  CREATE INDEX IF NOT EXISTS idx_service_due_periods_effective_from
    ON service_due_periods (effective_from);
  CREATE INDEX IF NOT EXISTS idx_service_due_periods_effective_until
    ON service_due_periods (effective_until);

  CREATE OR REPLACE FUNCTION update_service_due_periods_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $$
  BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
  END;
  $$;

  DROP TRIGGER IF EXISTS trg_service_due_periods_updated_at ON service_due_periods;

  CREATE TRIGGER trg_service_due_periods_updated_at
    BEFORE UPDATE ON service_due_periods
    FOR EACH ROW
    EXECUTE FUNCTION update_service_due_periods_updated_at();
`
