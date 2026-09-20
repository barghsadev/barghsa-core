import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamptz, uuidv7 } from '../types';
import { contractVersions } from './contracts';
import { documents } from './documents';
import { users } from './users';

/** A new original creates a new numbered request; prior requests are never overwritten. */
export const contractSignatureRequests = pgTable(
  'contract_signature_requests',
  {
    id: uuidv7('id').primaryKey().notNull(),
    contractId: uuid('contract_id').notNull(),
    versionId: uuid('version_id').notNull(),
    requestNumber: integer('request_number').notNull(),
    originalDocumentId: uuid('original_document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    requestedBy: text('requested_by')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    requestedAt: timestamptz('requested_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'signature_requests_version_fk',
      columns: [t.contractId, t.versionId],
      foreignColumns: [contractVersions.contractId, contractVersions.id],
    }).onDelete('restrict'),
    uniqueIndex('signature_requests_number_unique').on(t.versionId, t.requestNumber),
    index('signature_requests_contract_idx').on(t.contractId),
    check('signature_requests_positive_number', sql`${t.requestNumber}>0`),
  ]
);
/** The recorder and document uploader remain distinct from the paper signatory. */
export const contractSignatures = pgTable(
  'contract_signatures',
  {
    versionId: uuid('version_id').primaryKey().notNull(),
    contractId: uuid('contract_id').notNull(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => contractSignatureRequests.id, { onDelete: 'restrict' }),
    signedDocumentId: uuid('signed_document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    recordedBy: text('recorded_by')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    recordedByType: text('recorded_by_type').$type<'customer' | 'staff'>().notNull(),
    recordedAt: timestamptz('recorded_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'contract_signatures_version_fk',
      columns: [t.contractId, t.versionId],
      foreignColumns: [contractVersions.contractId, contractVersions.id],
    }).onDelete('restrict'),
    uniqueIndex('contract_signatures_request_unique').on(t.requestId),
    uniqueIndex('contract_signatures_document_unique').on(t.signedDocumentId),
    index('contract_signatures_contract_idx').on(t.contractId),
    check('contract_signatures_recorder_type', sql`${t.recordedByType} IN ('customer','staff')`),
  ]
);
export type ContractSignatureRequest = typeof contractSignatureRequests.$inferSelect;
export type ContractSignature = typeof contractSignatures.$inferSelect;
