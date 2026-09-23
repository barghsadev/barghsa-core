import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamptz, uuidv7 } from '../types';
import { contractVersions, contracts } from './contracts';
import { electricityOrders } from './electricity-orders';
import { invoices } from './invoices';
import { profiles } from './profiles';
import { users } from './users';

export const electricityPriceAdjustments = pgTable(
  'electricity_price_adjustments',
  {
    id: uuidv7('id').primaryKey().notNull(),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id, { onDelete: 'restrict' }),
    versionId: uuid('version_id').notNull(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => electricityOrders.id, { onDelete: 'restrict' }),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    originalInvoiceId: uuid('original_invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    proposedBy: text('proposed_by')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    finalizedBy: text('finalized_by').references(() => users.userId, { onDelete: 'restrict' }),
    reason: text('reason').notNull(),
    contractualBasis: text('contractual_basis').notNull(),
    percentageBps: bigint('percentage_bps', { mode: 'bigint' }).notNull(),
    effectiveFrom: timestamptz('effective_from').notNull(),
    periodEnd: timestamptz('period_end').notNull(),
    adjustmentAmount: bigint('adjustment_amount', { mode: 'bigint' }).notNull(),
    calculation: jsonb('calculation').$type<Record<string, unknown>>().notNull(),
    calculationSha256: text('calculation_sha256').notNull(),
    status: text('status', { enum: ['proposed', 'finalized', 'cancelled'] })
      .notNull()
      .default('proposed'),
    adjustmentInvoiceId: uuid('adjustment_invoice_id').references(() => invoices.id, {
      onDelete: 'restrict',
    }),
    finalizedAt: timestamptz('finalized_at'),
    cancelledAt: timestamptz('cancelled_at'),
    createdAt: timestamptz('created_at').defaultNow().notNull(),
    updatedAt: timestamptz('updated_at').defaultNow().notNull(),
  },
  (t) => [
    foreignKey({
      name: 'electricity_price_adjustments_version_fk',
      columns: [t.contractId, t.versionId],
      foreignColumns: [contractVersions.contractId, contractVersions.id],
    }).onDelete('restrict'),
    uniqueIndex('electricity_price_adjustments_proposed_contract_key')
      .on(t.contractId)
      .where(sql`${t.status}='proposed'`),
    uniqueIndex('electricity_price_adjustments_invoice_key').on(t.adjustmentInvoiceId),
    index('electricity_price_adjustments_contract_idx').on(t.contractId, t.createdAt),
    check(
      'electricity_price_adjustments_reason',
      sql`length(trim(${t.reason})) BETWEEN 1 AND 1000`
    ),
    check(
      'electricity_price_adjustments_basis',
      sql`length(trim(${t.contractualBasis})) BETWEEN 1 AND 2000`
    ),
    check(
      'electricity_price_adjustments_percentage',
      sql`${t.percentageBps}<>0 AND ${t.percentageBps}>-10000`
    ),
    check('electricity_price_adjustments_period', sql`${t.effectiveFrom}<${t.periodEnd}`),
    check('electricity_price_adjustments_amount', sql`${t.adjustmentAmount}<>0`),
    check('electricity_price_adjustments_sha', sql`${t.calculationSha256} ~ '^[0-9a-f]{64}$'`),
    check(
      'electricity_price_adjustments_state',
      sql`(
      (${t.status}='proposed' AND ${t.adjustmentInvoiceId} IS NULL AND ${t.finalizedBy} IS NULL AND ${t.finalizedAt} IS NULL AND ${t.cancelledAt} IS NULL)
      OR (${t.status}='finalized' AND ${t.adjustmentInvoiceId} IS NOT NULL AND ${t.finalizedBy} IS NOT NULL AND ${t.finalizedAt} IS NOT NULL AND ${t.cancelledAt} IS NULL)
      OR (${t.status}='cancelled' AND ${t.adjustmentInvoiceId} IS NULL AND ${t.finalizedBy} IS NULL AND ${t.finalizedAt} IS NULL AND ${t.cancelledAt} IS NOT NULL)
    )`
    ),
  ]
);
