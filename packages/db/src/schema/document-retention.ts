import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
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
