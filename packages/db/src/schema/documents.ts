import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { baseColumns } from '../base-table';
import { timestamptz, uuidv7 } from '../types';
import { profiles } from './profiles';
import { users } from './users';
import { storageRecords } from './storage-record';
import { contracts, contractVersions } from './contracts';

export const documentState = pgEnum('document_state', [
  'Uploading',
  'PendingScan',
  'Available',
  'SubmittedForReview',
  'Approved',
  'Rejected',
  'Superseded',
  'Quarantined',
  'Removed',
]);
export const documentScanState = pgEnum('document_scan_state', [
  'Uploading',
  'Pending',
  'Available',
  'Quarantined',
]);
export const documentBusinessType = pgEnum('document_business_type', [
  'contract',
  'invoice',
  'order',
  'solar_request',
  'standalone',
]);
export const documentUploaderType = pgEnum('document_uploader_type', [
  'customer',
  'staff',
  'system',
]);

export const documents = pgTable(
  'documents',
  {
    ...baseColumns,
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    businessRecordType: documentBusinessType('business_record_type').notNull(),
    businessRecordId: uuid('business_record_id'),
    category: text('category').notNull(),
    state: documentState('state').notNull().default('Uploading'),
    scanState: documentScanState('scan_state').notNull().default('Uploading'),
    scanSkippedReason: text('scan_skipped_reason'),
    uploadKey: text('upload_key')
      .notNull()
      .references(() => storageRecords.storageKey, { onDelete: 'restrict' }),
    storageKey: text('storage_key').references(() => storageRecords.storageKey, {
      onDelete: 'restrict',
    }),
    originalName: text('original_name').notNull(),
    detectedMime: text('detected_mime'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    checksum: text('checksum'),
    uploadedBy: text('uploaded_by')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    uploadedByType: documentUploaderType('uploaded_by_type').notNull(),
    // The migration installs the self-reference and enforces immutable, acyclic lineage.
    supersedesDocumentId: uuid('supersedes_document_id'),
    rejectionReason: text('rejection_reason'),
    reviewComment: text('review_comment'),
    revision: integer('revision').notNull().default(1),
    removedAt: timestamptz('removed_at'),
  },
  (t) => [
    uniqueIndex('documents_upload_unique').on(t.uploadKey),
    uniqueIndex('documents_storage_unique').on(t.storageKey),
    uniqueIndex('documents_successor_unique')
      .on(t.supersedesDocumentId)
      .where(sql`${t.storageKey} IS NOT NULL`),
    index('documents_profile_created_idx').on(t.profileId, t.createdAt, t.id),
    index('documents_business_idx').on(t.businessRecordType, t.businessRecordId),
    index('documents_review_idx').on(t.state, t.createdAt, t.id),
    index('documents_uploader_idx').on(t.uploadedBy),
    check(
      'documents_business_identity',
      sql`(${t.businessRecordType}='standalone') = (${t.businessRecordId} IS NULL)`
    ),
    check('documents_positive_size', sql`${t.sizeBytes} > 0 AND ${t.sizeBytes} <= 52428800`),
    check('documents_positive_revision', sql`${t.revision} > 0`),
    check('documents_name', sql`length(trim(${t.originalName})) BETWEEN 1 AND 255`),
    check('documents_category', sql`${t.category} IN ('document','image','video','contract')`),
    check('documents_checksum', sql`${t.checksum} IS NULL OR ${t.checksum} ~ '^[a-f0-9]{64}$'`),
    check(
      'documents_rejection_reason',
      sql`${t.state} <> 'Rejected' OR (${t.rejectionReason} IS NOT NULL AND length(trim(${t.rejectionReason})) BETWEEN 1 AND 1000)`
    ),
    check(
      'documents_scan_state',
      sql`(${t.state}<>'Uploading' OR ${t.scanState}='Uploading') AND (${t.state}<>'PendingScan' OR ${t.scanState}='Pending') AND (${t.state}<>'Quarantined' OR ${t.scanState}='Quarantined')`
    ),
    check(
      'documents_removed_timestamp',
      sql`(${t.state}='Removed') = (${t.removedAt} IS NOT NULL)`
    ),
    check(
      'documents_ready_content',
      sql`${t.state} IN ('Uploading','PendingScan','Quarantined','Removed') OR (${t.storageKey} IS NOT NULL AND ${t.detectedMime} IS NOT NULL AND ${t.checksum} IS NOT NULL AND ${t.scanState}='Available')`
    ),
  ]
);

export const documentEvents = pgTable(
  'document_events',
  {
    id: uuidv7('id').primaryKey().notNull(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    revision: integer('revision').notNull(),
    previousState: documentState('previous_state'),
    state: documentState('state').notNull(),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    reason: text('reason'),
    createdAt: timestamptz('created_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('document_events_revision_unique').on(t.documentId, t.revision),
    index('document_events_actor_idx').on(t.actorId),
  ]
);

export const contractDocumentRole = pgEnum('contract_document_role', [
  'original',
  'signed',
  'amendment',
  'superseded',
]);
export const contractDocuments = pgTable(
  'contract_documents',
  {
    id: uuidv7('id').primaryKey().notNull(),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id, { onDelete: 'restrict' }),
    contractVersionId: uuid('contract_version_id')
      .notNull()
      .references(() => contractVersions.id, { onDelete: 'restrict' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    role: contractDocumentRole('role').notNull(),
    createdAt: timestamptz('created_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('contract_documents_document_unique').on(t.documentId),
    index('contract_documents_version_idx').on(t.contractVersionId),
    index('contract_documents_contract_idx').on(t.contractId),
  ]
);

/** Retention lock derived from a signed contract state; this is not signature evidence. */
export const contractDocumentLocks = pgTable(
  'contract_document_locks',
  {
    documentId: uuid('document_id')
      .primaryKey()
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    contractVersionId: uuid('contract_version_id')
      .notNull()
      .references(() => contractVersions.id, { onDelete: 'restrict' }),
    lockedAt: timestamptz('locked_at').defaultNow().notNull(),
  },
  (t) => [index('contract_document_locks_version_idx').on(t.contractVersionId)]
);

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentEvent = typeof documentEvents.$inferSelect;
export type NewDocumentEvent = typeof documentEvents.$inferInsert;
export type ContractDocument = typeof contractDocuments.$inferSelect;
export type NewContractDocument = typeof contractDocuments.$inferInsert;
export type ContractDocumentLock = typeof contractDocumentLocks.$inferSelect;
export type NewContractDocumentLock = typeof contractDocumentLocks.$inferInsert;
