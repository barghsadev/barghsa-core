import { integer, text, timestamp } from 'drizzle-orm/pg-core'
import { createTable } from '../base-table.js'

/**
 * Service breach alert ledger (S-09.08, T-09.08.01).
 *
 * One row per (service_type, item_id) breach episode — inserted by the
 * worker breach scan when an open ticket / verification case exceeds its
 * admin-configured response target. The UNIQUE constraint is the dedup
 * mechanism: the scan inserts with ON CONFLICT DO NOTHING and only alerts
 * for rows it actually inserted, so the same item is never re-alerted on
 * every scan. When an item leaves the breached set the scan deletes its
 * row, so a later re-breach starts a fresh episode.
 *
 * Row layout:
 * - `service_type`  'ticket' | 'verification_case' — must stay in sync with
 *                   SERVICE_RESPONSE_TARGET_TYPES in @barghsa/shared/admin
 * - `item_id`       the open item's id (tickets.id / verification_cases.id)
 * - `target_hours`  snapshot of the breached target (survives later
 *                   reconfiguration for the audit trail)
 * - `alerted_at`    when the episode's alert was recorded (base column)
 * - `escalation_level`  highest escalation tier alerted for the episode
 *                   (1 = assigned, 2 = team lead, 3 = admin; T-09.08.03)
 * - `escalated_at`  when the current tier was emitted (NULL until the first
 *                   level-2 escalation; becomes the next tier's delay base)
 *
 * The escalation columns were added by migration `0039` (additive expand).
 * Database-level CHECK constraints live in the migrations only (Drizzle's
 * column builder in v0.40 does not expose `.check()`): `chk_sba_service_type`,
 * `chk_sba_target_hours`, `chk_sba_escalation_level`, plus the `uq_sba_item`
 * unique constraint. `service-breach-alerts.test.ts` pins migrations 0037 and
 * 0039 so a future `drizzle-kit generate` cannot silently drop them.
 *
 * @module db/schema
 */
export const serviceBreachAlerts = createTable('service_breach_alerts', {
  /** The service type whose open item breached its target. */
  serviceType: text('service_type').notNull(),

  /** The open item's id (tickets.id / verification_cases.id). */
  itemId: text('item_id').notNull(),

  /** Snapshot of the breached target in hours (always > 0). */
  targetHours: integer('target_hours').notNull(),

  /** When the episode's alert was recorded. */
  alertedAt: timestamp('alerted_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .notNull(),

  /**
   * Highest escalation tier alerted for the episode: 1 = assigned (the
   * breach alert, default), 2 = team lead, 3 = admin (T-09.08.03). 3 is
   * terminal — no further escalation.
   */
  escalationLevel: integer('escalation_level').notNull().default(1),

  /**
   * When the current {@link escalationLevel} was emitted; NULL until the
   * first level-2 escalation, at which point it becomes the delay baseline
   * for the next tier.
   */
  escalatedAt: timestamp('escalated_at', { withTimezone: true, mode: 'date' }),
})
