import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { irrAmount, timestamptz, uuidv7 } from '../types';
import { contractVersions } from './contracts';
import { users } from './users';
import { approvalRequests } from './approval-requests';
import { invoices } from './invoices';
import { refunds } from './refunds';
import { contractCancellationRequests } from './contract-cancellation-requests';

/** An immutable staff decision. Approval never changes the captured terms;
 * execution must revalidate the current version, policy and financial facts. */
export const contractCancellationIntents = pgTable(
  'contract_cancellation_intents',
  {
    id: uuidv7('id').primaryKey().notNull(),
    contractId: uuid('contract_id').notNull(),
    versionId: uuid('version_id').notNull(),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    reason: text('reason').notNull(),
    customerRequestId: uuid('customer_request_id').references(
      () => contractCancellationRequests.id,
      {
        onDelete: 'restrict',
      }
    ),
    refundDecision: jsonb('refund_decision').$type<Record<string, unknown>>().notNull(),
    financialSnapshot: jsonb('financial_snapshot').$type<Record<string, unknown>>().notNull(),
    financialFingerprint: text('financial_fingerprint').notNull(),
    financialImpactAmount: irrAmount('financial_impact_amount').notNull(),
    approvalPolicy: jsonb('approval_policy').$type<Record<string, unknown>>().notNull(),
    approvalRequestId: uuid('approval_request_id').references(() => approvalRequests.id, {
      onDelete: 'restrict',
    }),
    idempotencyKey: uuid('idempotency_key').notNull(),
    createdAt: timestamptz('created_at').defaultNow().notNull(),
  },
  (t) => [
    foreignKey({
      name: 'cancellation_intents_version_fk',
      columns: [t.contractId, t.versionId],
      foreignColumns: [contractVersions.contractId, contractVersions.id],
    }).onDelete('restrict'),
    uniqueIndex('cancellation_intents_idempotency_unique').on(t.idempotencyKey),
    uniqueIndex('cancellation_intents_approval_unique').on(t.approvalRequestId),
    uniqueIndex('cancellation_intents_identity_unique').on(t.contractId, t.id),
    index('cancellation_intents_contract_created_idx').on(t.contractId, t.createdAt),
    check('cancellation_intents_reason', sql`length(trim(${t.reason})) BETWEEN 1 AND 1000`),
    check('cancellation_intents_fingerprint', sql`${t.financialFingerprint} ~ '^[0-9a-f]{64}$'`),
    check('cancellation_intents_impact', sql`${t.financialImpactAmount} >= 0`),
    check(
      'cancellation_intents_snapshot_objects',
      sql`jsonb_typeof(${t.refundDecision})='object' AND jsonb_typeof(${t.financialSnapshot})='object' AND jsonb_typeof(${t.approvalPolicy})='object'`
    ),
  ]
);

/** One irreversible service cancellation per contract, bound to its reviewed intent. */
export const contractCancellations = pgTable(
  'contract_cancellations',
  {
    contractId: uuid('contract_id').primaryKey().notNull(),
    intentId: uuid('intent_id').notNull(),
    executedBy: text('executed_by')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    cancelledAt: timestamptz('cancelled_at').defaultNow().notNull(),
  },
  (t) => [
    foreignKey({
      name: 'contract_cancellations_intent_fk',
      columns: [t.contractId, t.intentId],
      foreignColumns: [contractCancellationIntents.contractId, contractCancellationIntents.id],
    }).onDelete('restrict'),
    uniqueIndex('contract_cancellations_intent_unique').on(t.intentId),
  ]
);

/** Mandatory returns retain their own financial lifecycle after service cancellation. */
export const contractRefundObligations = pgTable(
  'contract_refund_obligations',
  {
    refundId: uuid('refund_id')
      .primaryKey()
      .notNull()
      .references(() => refunds.id, { onDelete: 'restrict' }),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contractCancellations.contractId, { onDelete: 'restrict' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    createdAt: timestamptz('created_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('contract_refund_obligations_invoice_unique').on(t.contractId, t.invoiceId),
    index('contract_refund_obligations_contract_idx').on(t.contractId),
  ]
);
