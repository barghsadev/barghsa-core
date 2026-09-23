import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
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

export const electricityQuantityIncreaseRequests = pgTable(
  'electricity_quantity_increase_requests',
  {
    id: uuidv7('id').primaryKey().notNull(),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id, { onDelete: 'restrict' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => electricityOrders.id, { onDelete: 'restrict' }),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    versionId: uuid('version_id').notNull(),
    requestedBy: text('requested_by')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    originalKwh: bigint('original_kwh', { mode: 'bigint' }).notNull(),
    requestedKwh: bigint('requested_kwh', { mode: 'bigint' }).notNull(),
    maxPercentage: integer('max_percentage').notNull(),
    effectiveFrom: timestamptz('effective_from').notNull(),
    periodEnd: timestamptz('period_end').notNull(),
    status: text('status', {
      enum: [
        'pending',
        'rejected',
        'approved',
        'awaiting_signature',
        'awaiting_payment',
        'effective',
        'expired',
      ],
    })
      .notNull()
      .default('pending'),
    reviewedBy: text('reviewed_by').references(() => users.userId, { onDelete: 'restrict' }),
    reviewReason: text('review_reason'),
    reviewedAt: timestamptz('reviewed_at'),
    amendmentDocument: jsonb('amendment_document').$type<Record<string, unknown>>(),
    amendmentSha256: text('amendment_sha256'),
    signatureEvidence: jsonb('signature_evidence').$type<Record<string, unknown>>(),
    signedAt: timestamptz('signed_at'),
    pricingSnapshot: jsonb('pricing_snapshot').$type<Record<string, unknown>>(),
    adjustmentAmount: bigint('adjustment_amount', { mode: 'bigint' }),
    adjustmentInvoiceId: uuid('adjustment_invoice_id').references(() => invoices.id, {
      onDelete: 'restrict',
    }),
    effectiveAt: timestamptz('effective_at'),
    expiredAt: timestamptz('expired_at'),
    createdAt: timestamptz('created_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('electricity_quantity_increase_requests_contract_id_key').on(t.contractId),
    uniqueIndex('electricity_quantity_increase_invoice_id_key').on(t.adjustmentInvoiceId),
    foreignKey({
      name: 'electricity_quantity_increase_version_fk',
      columns: [t.contractId, t.versionId],
      foreignColumns: [contractVersions.contractId, contractVersions.id],
    }).onDelete('restrict'),
    index('electricity_quantity_increase_queue_idx').on(t.status, t.createdAt, t.id),
    check(
      'electricity_quantity_increase_amounts',
      sql`${t.originalKwh}>0 AND ${t.requestedKwh}>${t.originalKwh}`
    ),
    check(
      'electricity_quantity_increase_max_percentage',
      sql`${t.maxPercentage} BETWEEN 1 AND 1000`
    ),
    check('electricity_quantity_increase_period', sql`${t.periodEnd}>${t.effectiveFrom}`),
    check(
      'electricity_quantity_increase_status',
      sql`${t.status} IN ('pending','rejected','approved','awaiting_signature','awaiting_payment','effective','expired')`
    ),
    check(
      'electricity_quantity_increase_review_reason',
      sql`${t.reviewReason} IS NULL OR length(trim(${t.reviewReason})) BETWEEN 1 AND 1000`
    ),
    check(
      'electricity_quantity_increase_review_check',
      sql`(${t.status} IN ('pending','expired') AND ${t.reviewedBy} IS NULL AND ${t.reviewReason} IS NULL AND ${t.reviewedAt} IS NULL) OR (${t.status}<>'pending' AND ${t.reviewedBy} IS NOT NULL AND ${t.reviewedAt} IS NOT NULL)`
    ),
    check(
      'electricity_quantity_increase_amendment_check',
      sql`(${t.amendmentDocument} IS NULL AND ${t.amendmentSha256} IS NULL AND ${t.status} IN ('pending','rejected','expired')) OR (${t.amendmentDocument} IS NOT NULL AND ${t.amendmentSha256} ~ '^[0-9a-f]{64}$' AND ${t.status} NOT IN ('pending','rejected'))`
    ),
    check(
      'electricity_quantity_increase_signature_check',
      sql`((${t.status} IN ('pending','rejected','awaiting_signature') OR (${t.status}='expired' AND ${t.signedAt} IS NULL)) AND ${t.signatureEvidence} IS NULL AND ${t.signedAt} IS NULL AND ${t.pricingSnapshot} IS NULL AND ${t.adjustmentAmount} IS NULL AND ${t.adjustmentInvoiceId} IS NULL AND ${t.effectiveAt} IS NULL) OR ((${t.status} IN ('awaiting_payment','effective') OR (${t.status}='expired' AND ${t.signedAt} IS NOT NULL)) AND ${t.signatureEvidence} IS NOT NULL AND ${t.signedAt} IS NOT NULL AND ${t.pricingSnapshot} IS NOT NULL AND ${t.adjustmentAmount}>0 AND ${t.adjustmentInvoiceId} IS NOT NULL)`
    ),
    check(
      'electricity_quantity_increase_expired_at_check',
      sql`(${t.status}='expired') = (${t.expiredAt} IS NOT NULL)`
    ),
  ]
);
