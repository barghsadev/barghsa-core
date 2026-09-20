import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamptz } from '../types';
import { contractServiceType, contractVersions } from './contracts';
import { invoices } from './invoices';
import { users } from './users';

/** Changes apply to new versions; accepted versions keep their requirements. */
export const contractActivationRules = pgTable(
  'contract_activation_rules',
  {
    serviceType: contractServiceType('service_type').primaryKey().notNull(),
    signatureRequired: boolean('signature_required').notNull(),
    paymentRequired: boolean('payment_required').notNull(),
    serviceStartRequired: boolean('service_start_required').notNull().default(false),
    revision: integer('revision').notNull().default(1),
    updatedBy: text('updated_by').references(() => users.userId, { onDelete: 'restrict' }),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('activation_rules_revision_positive', sql`${t.revision}>0`),
    check(
      'activation_rules_solar_signature',
      sql`${t.serviceType}<>'solar' OR ${t.signatureRequired}`
    ),
    check(
      'activation_rules_electricity_payment',
      sql`${t.serviceType}<>'electricity' OR ${t.paymentRequired}`
    ),
  ]
);

/** Immutable rule snapshot plus draft-only context, locked on publication. */
export const contractActivationRequirements = pgTable(
  'contract_activation_requirements',
  {
    versionId: uuid('version_id').primaryKey().notNull(),
    contractId: uuid('contract_id').notNull(),
    ruleRevision: integer('rule_revision').notNull(),
    signatureRequired: boolean('signature_required').notNull(),
    paymentRequired: boolean('payment_required').notNull(),
    serviceStartRequired: boolean('service_start_required').notNull(),
    initialInvoiceId: uuid('initial_invoice_id').references(() => invoices.id, {
      onDelete: 'restrict',
    }),
    serviceStartsAt: timestamptz('service_starts_at'),
    capturedAt: timestamptz('captured_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'activation_requirements_version_fk',
      columns: [t.contractId, t.versionId],
      foreignColumns: [contractVersions.contractId, contractVersions.id],
    }).onDelete('restrict'),
    check('activation_requirements_revision_positive', sql`${t.ruleRevision}>0`),
    index('activation_requirements_contract_idx').on(t.contractId),
    index('activation_requirements_invoice_idx').on(t.initialInvoiceId),
  ]
);
export type ContractActivationRule = typeof contractActivationRules.$inferSelect;
export type ContractActivationRequirement = typeof contractActivationRequirements.$inferSelect;
