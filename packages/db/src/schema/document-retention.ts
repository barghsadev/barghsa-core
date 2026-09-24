import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamptz, uuidv7 } from '../types';
import { documents } from './documents';
import { profiles } from './profiles';
import { users } from './users';

export const documentRetentionPolicies = pgTable(
  'document_retention_policies',
  {
    id: uuidv7('id').primaryKey().notNull(),
    businessRecordType: text('business_record_type').notNull(),
    retentionYears: integer('retention_years').notNull(),
    legalHold: boolean('legal_hold').notNull().default(false),
    approvalNote: text('approval_note').notNull(),
    effectiveDate: timestamptz('effective_date').defaultNow().notNull(),
    createdBy: text('created_by').references(() => users.userId, { onDelete: 'restrict' }),
    createdAt: timestamptz('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('document_retention_policies_current_idx').on(
      t.businessRecordType,
      t.effectiveDate,
      t.id
    ),
    check(
      'document_retention_policies_type',
      sql`${t.businessRecordType} IN ('contract','invoice','payment','refund','signed_document','order','solar_request','standalone')`
    ),
    check('document_retention_policies_years', sql`${t.retentionYears} BETWEEN 1 AND 100`),
    check(
      'document_retention_policies_note',
      sql`length(trim(${t.approvalNote})) BETWEEN 3 AND 1000`
    ),
  ]
);

export const documentLegalHolds = pgTable(
  'document_legal_holds',
  {
    id: uuidv7('id').primaryKey().notNull(),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'restrict' }),
    profileId: uuid('profile_id').references(() => profiles.id, { onDelete: 'restrict' }),
    reason: text('reason').notNull(),
    initiatedBy: text('initiated_by')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    initiatedAt: timestamptz('initiated_at').defaultNow().notNull(),
    expiresAt: timestamptz('expires_at'),
    releasedBy: text('released_by').references(() => users.userId, { onDelete: 'restrict' }),
    releasedAt: timestamptz('released_at'),
  },
  (t) => [
    index('document_legal_holds_document_idx').on(t.documentId, t.releasedAt),
    index('document_legal_holds_profile_idx').on(t.profileId, t.releasedAt),
    check('document_legal_holds_scope', sql`(${t.documentId} IS NULL) <> (${t.profileId} IS NULL)`),
    check('document_legal_holds_reason', sql`length(trim(${t.reason})) BETWEEN 3 AND 1000`),
    check(
      'document_legal_holds_expiry',
      sql`${t.expiresAt} IS NULL OR ${t.expiresAt} > ${t.initiatedAt}`
    ),
    check(
      'document_legal_holds_release',
      sql`(${t.releasedBy} IS NULL) = (${t.releasedAt} IS NULL)`
    ),
  ]
);

/** Approval and retry ledger for irreversible, version-aware object destruction. */
export const documentDestructionItems = pgTable(
  'document_destruction_items',
  {
    id: uuidv7('id').primaryKey().notNull(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    policyId: uuid('policy_id')
      .notNull()
      .references(() => documentRetentionPolicies.id, { onDelete: 'restrict' }),
    storageKey: text('storage_key').notNull(),
    uploadKey: text('upload_key').notNull(),
    retentionDeadline: timestamptz('retention_deadline').notNull(),
    status: text('status').notNull().default('pending_approval'),
    plannedAt: timestamptz('planned_at').defaultNow().notNull(),
    approvedBy: text('approved_by').references(() => users.userId, { onDelete: 'restrict' }),
    approvedAt: timestamptz('approved_at'),
    destructionStartedAt: timestamptz('destruction_started_at'),
    destroyedAt: timestamptz('destroyed_at'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    updatedAt: timestamptz('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('document_destruction_active_document_unique')
      .on(t.documentId)
      .where(sql`${t.status} IN ('pending_approval','approved','destroying')`),
    index('document_destruction_status_idx').on(t.status, t.plannedAt),
    index('document_destruction_profile_idx').on(t.profileId, t.status),
    check(
      'document_destruction_status',
      sql`${t.status} IN ('pending_approval','approved','destroying','cancelled','destroyed')`
    ),
    check('document_destruction_attempts', sql`${t.attempts} >= 0`),
    check(
      'document_destruction_approval',
      sql`(${t.status} = 'pending_approval' AND ${t.approvedBy} IS NULL AND ${t.approvedAt} IS NULL AND ${t.destructionStartedAt} IS NULL AND ${t.destroyedAt} IS NULL)
        OR (${t.status} = 'cancelled' AND ${t.destroyedAt} IS NULL)
        OR (${t.status} = 'approved' AND ${t.approvedBy} IS NOT NULL AND ${t.approvedAt} IS NOT NULL AND ${t.destructionStartedAt} IS NULL AND ${t.destroyedAt} IS NULL)
        OR (${t.status} = 'destroying' AND ${t.approvedBy} IS NOT NULL AND ${t.approvedAt} IS NOT NULL AND ${t.destructionStartedAt} IS NOT NULL AND ${t.destroyedAt} IS NULL)
        OR (${t.status} = 'destroyed' AND ${t.approvedBy} IS NOT NULL AND ${t.approvedAt} IS NOT NULL AND ${t.destructionStartedAt} IS NOT NULL AND ${t.destroyedAt} IS NOT NULL)`
    ),
  ]
);

export type DocumentDestructionItem = typeof documentDestructionItems.$inferSelect;
