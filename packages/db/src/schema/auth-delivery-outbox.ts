import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  index,
  check,
  boolean,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { otpChallenges } from './otp-challenge.js';

export const authDeliveryOutbox = pgTable(
  'auth_delivery_outbox',
  {
    id: uuid('id').primaryKey(),
    /** Retained after the encrypted message is erased; NULL for older writers. */
    correlationId: text('correlation_id'),
    challengeId: text('challenge_id').references(() => otpChallenges.challengeId),
    kind: text('kind').notNull().default('otp'),
    userId: text('user_id').references(() => users.userId),
    codeHash: text('code_hash').notNull(),
    encryptedPayload: text('encrypted_payload'),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    leaseToken: uuid('lease_token'),
    providerRef: text('provider_ref'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    /** Captured account identity, never resolved by looking up the current contact owner. */
    noticeUserId: text('notice_user_id').references(() => users.userId, { onDelete: 'cascade' }),
    inboxNoticePending: boolean('inbox_notice_pending').notNull().default(true),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'auth_delivery_binding_check',
      sql`(${table.kind}='otp' AND ${table.challengeId} IS NOT NULL AND ${table.userId} IS NULL) OR (${table.kind}='staff_activation' AND ${table.challengeId} IS NULL AND ${table.userId} IS NOT NULL)`
    ),
    index('auth_delivery_due_idx').on(table.status, table.availableAt),
    index('auth_delivery_inbox_notice_idx')
      .on(table.sentAt, table.id)
      .where(
        sql`${table.status}='sent' AND ${table.kind}='otp' AND ${table.inboxNoticePending} AND ${table.noticeUserId} IS NOT NULL`
      ),
    check(
      'auth_delivery_status_check',
      sql`${table.status} IN ('pending','leased','sent','cancelled','dead')`
    ),
    check('auth_delivery_attempts_check', sql`${table.attempts} >= 0`),
  ]
);
