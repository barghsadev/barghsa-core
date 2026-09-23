import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { baseColumns } from '../base-table';
import { timestamptz, uuidv7 } from '../types';
import { profiles } from './profiles';
import { orders } from './orders';
import { users } from './users';

export const contractServiceType = pgEnum('contract_service_type', [
  'electricity',
  'savings',
  'solar',
]);
export const contractState = pgEnum('contract_state', [
  'Draft',
  'AwaitingStaffReview',
  'ChangesRequested',
  'AwaitingCustomerAcceptance',
  'Accepted',
  'AwaitingSignature',
  'Signed',
  'Active',
  'Completed',
  'Rejected',
  'Cancelled',
]);
export const contracts = pgTable(
  'contracts',
  {
    ...baseColumns,
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'restrict' }),
    serviceType: contractServiceType('service_type').notNull(),
    state: contractState('state').notNull().default('Draft'),
    // Deferred composite FK is installed by the migration to permit atomic initial version creation.
    currentVersionId: uuid('current_version_id').notNull(),
    submittedAt: timestamptz('submitted_at'),
    acceptedAt: timestamptz('accepted_at'),
    signedAt: timestamptz('signed_at'),
    activatedAt: timestamptz('activated_at'),
    completedAt: timestamptz('completed_at'),
    cancelledAt: timestamptz('cancelled_at'),
  },
  (t) => [
    index('contracts_profile_created_idx').on(t.profileId, t.createdAt, t.id),
    index('contracts_order_idx').on(t.orderId),
    index('contracts_state_idx').on(t.state),
  ]
);
export const contractVersions = pgTable(
  'contract_versions',
  {
    id: uuidv7('id').primaryKey().notNull(),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id, { onDelete: 'restrict' }),
    versionNumber: integer('version_number').notNull(),
    content: jsonb('content').$type<Record<string, unknown>>().notNull(),
    changeDescription: text('change_description').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    createdAt: timestamptz('created_at').defaultNow().notNull(),
    acceptedAt: timestamptz('accepted_at'),
  },
  (t) => [
    uniqueIndex('contract_versions_number_unique').on(t.contractId, t.versionNumber),
    uniqueIndex('contract_versions_identity_unique').on(t.contractId, t.id),
    check('contract_versions_positive', sql`${t.versionNumber} > 0`),
    check(
      'contract_versions_object',
      sql`jsonb_typeof(${t.content}) = 'object' AND ${t.content} <> '{}'::jsonb`
    ),
    check(
      'contract_versions_description',
      sql`length(trim(${t.changeDescription})) BETWEEN 1 AND 1000`
    ),
  ]
);
// Keep the circular FK in SQL: Drizzle does not represent DEFERRABLE constraints.
export type Contract = typeof contracts.$inferSelect;
export type NewContract = typeof contracts.$inferInsert;
export type ContractVersion = typeof contractVersions.$inferSelect;
export type NewContractVersion = typeof contractVersions.$inferInsert;
