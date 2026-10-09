import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { baseColumns } from '../base-table';
import { profiles } from './profiles';
import { users } from './users';
import { otpChallenges } from './otp-challenge';

export const accountRecoveryCases = pgTable(
  'account_recovery_cases',
  {
    ...baseColumns,
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    targetUserId: text('target_user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    authVersion: integer('auth_version').notNull(),
    oldLogin: text('old_login').notNull(),
    newLogin: text('new_login').notNull(),
    supportReference: text('support_reference').notNull(),
    reason: text('reason').notNull(),
    evidenceKeys: jsonb('evidence_keys').$type<string[]>().notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    state: text('state').notNull().default('open'),
    reviewedBy: text('reviewed_by').references(() => users.userId, { onDelete: 'restrict' }),
    reviewerNotes: text('reviewer_notes'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'date' }),
    challengeId: text('challenge_id').references(() => otpChallenges.challengeId, {
      onDelete: 'restrict',
    }),
    contactVerifiedAt: timestamp('contact_verified_at', { withTimezone: true, mode: 'date' }),
    approvalExpiresAt: timestamp('approval_expires_at', { withTimezone: true, mode: 'date' }),
    appliedAt: timestamp('applied_at', { withTimezone: true, mode: 'date' }),
    noticeReferences: jsonb('notice_references').$type<{
      oldContact: string;
      newContact: string;
    }>(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    index('account_recovery_profile_idx').on(t.profileId, t.createdAt),
    uniqueIndex('account_recovery_open_target')
      .on(t.targetUserId)
      .where(sql`${t.state} IN ('open','approved','applied')`),
    check(
      'account_recovery_state',
      sql`${t.state} IN ('open','approved','rejected','applied','completed')`
    ),
    check(
      'account_recovery_distinct_review',
      sql`${t.reviewedBy} IS NULL OR ${t.reviewedBy}<>${t.createdBy}`
    ),
    check('account_recovery_distinct_login', sql`${t.oldLogin}<>${t.newLogin}`),
    check(
      'account_recovery_evidence',
      sql`jsonb_typeof(${t.evidenceKeys})='array' AND jsonb_array_length(${t.evidenceKeys}) BETWEEN 1 AND 5`
    ),
    check(
      'account_recovery_approval',
      sql`${t.state} NOT IN ('approved','applied','completed') OR (${t.reviewedBy} IS NOT NULL AND ${t.reviewedAt} IS NOT NULL AND ${t.reviewerNotes} IS NOT NULL AND ${t.approvalExpiresAt} IS NOT NULL)`
    ),
    check(
      'account_recovery_applied',
      sql`${t.state} NOT IN ('applied','completed') OR (${t.appliedAt} IS NOT NULL AND ${t.contactVerifiedAt} IS NOT NULL AND ${t.challengeId} IS NOT NULL)`
    ),
    check(
      'account_recovery_complete',
      sql`${t.state}<>'completed' OR (${t.completedAt} IS NOT NULL AND ${t.noticeReferences} IS NOT NULL AND ${t.noticeReferences} ?& ARRAY['oldContact','newContact'] AND jsonb_typeof(${t.noticeReferences}->'oldContact')='string' AND jsonb_typeof(${t.noticeReferences}->'newContact')='string' AND jsonb_typeof(${t.noticeReferences})='object' AND length(${t.noticeReferences}->>'oldContact')>0 AND length(${t.noticeReferences}->>'newContact')>0)`
    ),
  ]
);
export type AccountRecoveryCase = typeof accountRecoveryCases.$inferSelect;
