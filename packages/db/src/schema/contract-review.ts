import { foreignKey, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { timestamptz } from '../types';
import { contractVersions } from './contracts';
import { users } from './users';

/** Publication is the durable boundary between internal drafts and customer-visible versions. */
export const contractPublications = pgTable(
  'contract_publications',
  {
    versionId: uuid('version_id').primaryKey().notNull(),
    contractId: uuid('contract_id').notNull(),
    publishedBy: text('published_by')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    publishedAt: timestamptz('published_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'contract_publications_version_fk',
      columns: [t.contractId, t.versionId],
      foreignColumns: [contractVersions.contractId, contractVersions.id],
    }).onDelete('restrict'),
    index('contract_publications_contract_idx').on(t.contractId),
  ]
);
/** Immutable acceptance identifies the actual customer actor, never a staff surrogate. */
export const contractAcceptances = pgTable(
  'contract_acceptances',
  {
    versionId: uuid('version_id').primaryKey().notNull(),
    contractId: uuid('contract_id').notNull(),
    acceptedBy: text('accepted_by')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    acceptedAt: timestamptz('accepted_at').notNull().defaultNow(),
    partySnapshot: jsonb('party_snapshot').$type<{
      profileId: string;
      profileType: 'INDIVIDUAL' | 'LEGAL';
      name: string | null;
      identifier: string | null;
      registrationNumber: string | null;
    }>(),
  },
  (t) => [
    foreignKey({
      name: 'contract_acceptances_version_fk',
      columns: [t.contractId, t.versionId],
      foreignColumns: [contractVersions.contractId, contractVersions.id],
    }).onDelete('restrict'),
    index('contract_acceptances_contract_idx').on(t.contractId),
  ]
);
export type ContractPublication = typeof contractPublications.$inferSelect;
export type ContractAcceptance = typeof contractAcceptances.$inferSelect;
