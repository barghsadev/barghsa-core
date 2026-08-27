import { jsonb, text, timestamp } from 'drizzle-orm/pg-core'
import { createTable } from '../base-table.js'
import { users } from './users.js'
import { irrAmount } from '../types.js'

/**
 * Dual-approval request table (S-09.07, T-09.07.02).
 *
 * A financial action (refund, manual adjustment, bank payment confirmation)
 * whose amount exceeds the admin-configured dual-approval threshold
 * (T-09.07.01) is recorded here in the `pending` state. A second authorized
 * user — different from the initiator — must approve or reject it. Both
 * actions are additionally recorded in `audit_log` for the durable,
 * tamper-evident trail.
 *
 * Row layout:
 * - `action_type`   one of refund | manual_adjustment | bank_payment_confirmation
 * - `amount_irr`    positive BIGINT IRR amount
 * - `initiator_id`  the user who initiated the financial action (FK users)
 * - `reason`        human-readable reason for the action
 * - `details`       optional JSONB transaction details (audit payload)
 * - `status`        pending | approved | rejected
 * - `reviewer_id`   the second user who resolved the request (FK users,
 *                   SET NULL on user deletion so the audit row survives)
 * - `review_reason` mandatory on reject, optional on approve
 * - `reviewed_at`   when the request left the pending state
 * - created_at / updated_at (base columns)
 *
 * Invariants enforced by the service layer (T-09.07.02):
 * - a request can never be resolved by its own initiator,
 * - a resolved request can never be re-resolved,
 * - a rejection always carries a reason.
 *
 * @module db/schema
 */
export const approvalRequests = createTable('approval_requests', {
  /** Financial action being approved. */
  actionType: text('action_type').notNull(),

  /** IRR amount of the action, a positive integer. */
  amountIrR: irrAmount('amount_irr').notNull(),

  /** The user who initiated the financial action. */
  initiatorId: text('initiator_id')
    .notNull()
    .references(() => users.userId, { onDelete: 'restrict' }),

  /** Human-readable reason for the financial action. */
  reason: text('reason').notNull(),

  /** Optional JSONB transaction details captured at initiation. */
  details: jsonb('details').notNull().default({}),

  /** Lifecycle state: pending | approved | rejected. */
  status: text('status').notNull().default('pending'),

  /** The second authorized user who resolved the request. */
  reviewerId: text('reviewer_id').references(() => users.userId, {
    onDelete: 'set null',
  }),

  /** Resolution note; mandatory on reject. */
  reviewReason: text('review_reason'),

  /** When the request left the pending state. */
  reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'date' }),
})