import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { timestamptz, uuidv7 } from '../types';
import { contractVersions } from './contracts';
import { users } from './users';

export const contractCancellationRequests = pgTable(
  'contract_cancellation_requests',
  {
    id: uuidv7('id').primaryKey().notNull(),
    contractId: uuid('contract_id').notNull(),
    versionId: uuid('version_id').notNull(),
    requestedBy: text('requested_by')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    reason: text('reason').notNull(),
    preferredDestination: text('preferred_destination').notNull(),
    status: text('status').default('Pending').notNull(),
    resolvedBy: text('resolved_by').references(() => users.userId, { onDelete: 'restrict' }),
    resolutionReason: text('resolution_reason'),
    createdAt: timestamptz('created_at').defaultNow().notNull(),
    resolvedAt: timestamptz('resolved_at'),
  },
  (t) => [
    foreignKey({
      name: 'cancellation_requests_version_fk',
      columns: [t.contractId, t.versionId],
      foreignColumns: [contractVersions.contractId, contractVersions.id],
    }).onDelete('restrict'),
    uniqueIndex('cancellation_requests_pending_unique')
      .on(t.contractId)
      .where(sql`${t.status}='Pending'`),
    index('cancellation_requests_contract_created_idx').on(t.contractId, t.createdAt),
    check('cancellation_requests_reason', sql`length(trim(${t.reason})) BETWEEN 1 AND 1000`),
    check(
      'cancellation_requests_destination',
      sql`${t.preferredDestination} IN ('wallet','external_bank')`
    ),
    check(
      'cancellation_requests_resolution',
      sql`(${t.status}='Pending' AND ${t.resolvedBy} IS NULL AND ${t.resolutionReason} IS NULL AND ${t.resolvedAt} IS NULL) OR (${t.status} IN ('Rejected','Fulfilled') AND ${t.resolvedBy} IS NOT NULL AND ${t.resolvedAt} IS NOT NULL AND ${t.resolutionReason} IS NOT NULL AND length(trim(${t.resolutionReason})) BETWEEN 1 AND 1000)`
    ),
  ]
);
