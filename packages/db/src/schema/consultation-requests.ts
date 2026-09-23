import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { uuidv7, irrAmount } from '../types';
import { profiles } from './profiles';
import { products } from './products';
import { users } from './users';
import { invoices } from './invoices';

export const CONSULTATION_STATUSES = [
  'submitted',
  'under_review',
  'awaiting_customer_info',
  'offer_pending',
  'offer_accepted',
  'offer_declined',
  'completed',
  'rejected',
  'cancelled',
] as const;

/** Profile-scoped, staff-priced consultation workflow. */
export const consultationRequests = pgTable(
  'consultation_requests',
  {
    id: uuidv7('id').primaryKey().notNull(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    productSnapshot: jsonb('product_snapshot').notNull(),
    submittedBy: text('submitted_by')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    submissionKey: uuid('submission_key').notNull(),
    status: text('status').notNull().default('submitted'),
    staffOwnerId: text('staff_owner_id').references(() => users.userId, { onDelete: 'restrict' }),
    staffTeam: varchar('staff_team', { length: 100 }),
    fee: irrAmount('fee'),
    scope: text('scope'),
    deliverables: text('deliverables'),
    expectedNextStep: text('expected_next_step'),
    offerValidUntil: timestamp('offer_valid_until', { withTimezone: true }),
    invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'restrict' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('consultation_submission_key').on(t.submittedBy, t.submissionKey),
    index('consultation_profile_idx').on(t.profileId, t.submittedAt, t.id),
    index('consultation_status_idx').on(t.status, t.submittedAt, t.id),
    check(
      'consultation_status',
      sql`${t.status} IN ('submitted','under_review','awaiting_customer_info','offer_pending','offer_accepted','offer_declined','completed','rejected','cancelled')`
    ),
    check('consultation_fee', sql`${t.fee} IS NULL OR ${t.fee}>0`),
  ]
);

/** Append-only status history shown to customer and staff. */
export const consultationRequestEvents = pgTable(
  'consultation_request_events',
  {
    id: uuidv7('id').primaryKey().notNull(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => consultationRequests.id, { onDelete: 'restrict' }),
    status: text('status').notNull(),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('consultation_events_request_idx').on(t.requestId, t.createdAt, t.id),
    check(
      'consultation_event_status',
      sql`${t.status} IN ('submitted','under_review','awaiting_customer_info','offer_pending','offer_accepted','offer_declined','completed','rejected','cancelled')`
    ),
  ]
);
