import { jsonb, text, timestamp } from 'drizzle-orm/pg-core'
import { createTable } from '../base-table.js'
import { users } from './users.js'

/**
 * Reconciliation exception ledger (S-09.09, T-09.09.01).
 *
 * One row per reconciliation mismatch (wallet balance vs. ledger sum,
 * payment amount vs. provider, …). Rows are *produced* by the finance
 * reconciliation system (a later epic dependency) and *reviewed* by
 * admin/staff through the admin surface here.
 *
 * Row layout:
 * - `exception_type`  wallet_mismatch | payment_mismatch — must stay in
 *   sync with RECONCILIATION_EXCEPTION_TYPES in @barghsa/shared/admin
 * - `severity`        low | medium | high | critical
 * - `status`          open | investigating | resolved | closed
 * - `description`     human-readable summary of the mismatch
 * - `details`         optional JSONB full mismatch payload (audit copy)
 * - `assigned_to_id`  staff member working the exception (FK users, SET NULL)
 * - `resolved_by_id`  the staff member who resolved/closed it (SET NULL)
 * - `resolution_note` explanation recorded when resolved/closed
 * - `resolved_at`     when the item left open/investigating
 *
 * Invariants enforced by the service layer (T-09.09.01):
 * - `open`   → `investigating` → `resolved`; each transition is forward-only
 *   and audited (`resolution_recorded`).
 * - a resolution/close always carries a note;
 * - a terminal item (resolved/closed) can never move again.
 *
 * Database-level CHECK constraints live in migration `0040` only (Drizzle's
 * column builder in v0.40 does not expose `.check()`): `chk_rex_type`,
 * `chk_rex_severity`, `chk_rex_status`, plus the composite list index
 * `idx_reconciliation_exceptions_status_created_at`.
 * `reconciliation-exceptions.test.ts` pins migration 0040 so a future
 * `drizzle-kit generate` cannot silently drop them.
 *
 * @module db/schema
 */
export const reconciliationExceptions = createTable('reconciliation_exceptions', {
  /** The kind of mismatch (wallet balance vs ledger, payment, …). */
  exceptionType: text('exception_type').notNull(),

  /** Severity ladder for triage (low | medium | high | critical). */
  severity: text('severity').notNull().default('medium'),

  /** Lifecycle state: open | investigating | resolved | closed. */
  status: text('status').notNull().default('open'),

  /** Human-readable summary of the mismatch. */
  description: text('description').notNull(),

  /** Optional JSONB full reconciliation payload (audit copy). */
  details: jsonb('details').notNull().default({}),

  /** The staff member currently working the exception (FK users). */
  assignedToId: text('assigned_to_id').references(() => users.userId, {
    onDelete: 'set null',
  }),

  /** The staff member who resolved/closed the exception (FK users). */
  resolvedById: text('resolved_by_id').references(() => users.userId, {
    onDelete: 'set null',
  }),

  /** Mandatory explainer recorded when the item is resolved or closed. */
  resolutionNote: text('resolution_note'),

  /** When the item was resolved/closed. */
  resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
})