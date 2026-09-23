import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { baseColumns } from '../base-table';
import { irrAmount, uuidv7 } from '../types';
import { addresses } from './addresses';
import { orders } from './orders';
import { contracts, contractVersions } from './contracts';
import { products } from './products';
import { profiles } from './profiles';
import { savingPlanAgreementVersions } from './saving-plan-catalogue';
import { users } from './users';
import { invoices } from './invoices';

/** Resumable customer wizard progress; removed when the order is submitted. */
export const savingCustomerDrafts = pgTable(
  'saving_customer_drafts',
  {
    id: uuidv7('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    currentStep: integer('current_step').notNull().default(1),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('saving_customer_drafts_owner_unique').on(table.userId, table.profileId),
    check('saving_customer_drafts_step', sql`${table.currentStep} BETWEEN 1 AND 6`),
    check(
      'saving_customer_drafts_data',
      sql`jsonb_typeof(${table.data}) = 'object' AND octet_length(${table.data}::text) <= 8192`
    ),
  ]
);

export const savingOrders = pgTable(
  'saving_orders',
  {
    ...baseColumns,
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    savingPlanId: uuid('saving_plan_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    hardwareProductId: uuid('hardware_product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    billIdentifier: varchar('bill_identifier', { length: 13 }).notNull(),
    installationAddressId: uuid('installation_address_id')
      .notNull()
      .references(() => addresses.id, { onDelete: 'restrict' }),
    agreementVersionId: uuid('agreement_version_id')
      .notNull()
      .references(() => savingPlanAgreementVersions.id, { onDelete: 'restrict' }),
    agreementSnapshot: text('agreement_snapshot').notNull(),
    addressSnapshot: jsonb('address_snapshot').notNull(),
    pricingSnapshot: jsonb('pricing_snapshot').notNull(),
    verificationResult: jsonb('verification_result').notNull(),
    status: text('status').notNull().default('submitted'),
    financialStatus: text('financial_status').notNull().default('unpaid'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('saving_orders_order_key').on(table.orderId),
    index('saving_orders_profile_submitted_idx').on(table.profileId, table.submittedAt),
    uniqueIndex('saving_orders_active_bill_plan_key')
      .on(table.billIdentifier, table.savingPlanId)
      .where(
        sql`${table.status} IN ('submitted','awaiting_staff_review','approved','in_progress')`
      ),
    check('saving_orders_bill_identifier', sql`${table.billIdentifier} ~ '^[0-9]{6,13}$'`),
    check(
      'saving_orders_status',
      sql`${table.status} IN ('draft','submitted','awaiting_staff_review','approved','in_progress','completed','cancelled','rejected')`
    ),
    check(
      'saving_orders_financial_status',
      sql`${table.financialStatus} IN ('unpaid','paid','refund_pending','refunded')`
    ),
    check(
      'saving_orders_snapshots',
      sql`jsonb_typeof(${table.addressSnapshot})='object' AND jsonb_typeof(${table.pricingSnapshot})='object' AND jsonb_typeof(${table.verificationResult})='object'`
    ),
  ]
);

export const savingOrderLines = pgTable(
  'saving_order_lines',
  {
    ...baseColumns,
    orderId: uuid('order_id')
      .notNull()
      .references(() => savingOrders.id, { onDelete: 'restrict' }),
    description: text('description').notNull(),
    amount: irrAmount('amount').notNull(),
    type: text('type').notNull(),
  },
  (table) => [
    index('saving_order_lines_order_idx').on(table.orderId),
    check(
      'saving_order_lines_type',
      sql`${table.type} IN ('plan_price','hardware_price','discount','vat')`
    ),
    check(
      'saving_order_lines_amount',
      sql`(${table.type}='discount' AND ${table.amount}<=0) OR (${table.type}<>'discount' AND ${table.amount}>=0)`
    ),
  ]
);

export const savingFulfillmentStages = pgTable(
  'saving_fulfillment_stages',
  {
    ...baseColumns,
    orderId: uuid('order_id')
      .notNull()
      .references(() => savingOrders.id, { onDelete: 'restrict' }),
    stage: text('stage').notNull(),
    status: text('status').notNull().default('pending'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedBy: text('completed_by').references(() => users.userId, { onDelete: 'restrict' }),
    explanation: text('explanation'),
    handoverDescription: text('handover_description'),
  },
  (table) => [
    uniqueIndex('saving_fulfillment_order_stage_key').on(table.orderId, table.stage),
    check(
      'saving_fulfillment_stage',
      sql`${table.stage} IN ('request_confirmation','product_delivery','installation_and_document_upload','equipment_handover','process_completion')`
    ),
    check(
      'saving_fulfillment_status',
      sql`${table.status} IN ('pending','in_progress','completed','skipped')`
    ),
    check(
      'saving_fulfillment_completion',
      sql`${table.status} NOT IN ('completed','skipped') OR (${table.completedAt} IS NOT NULL AND ${table.completedBy} IS NOT NULL)`
    ),
    check(
      'saving_fulfillment_handover',
      sql`${table.stage}='equipment_handover' OR ${table.status}<>'skipped'`
    ),
  ]
);

export const savingFulfillmentEvents = pgTable(
  'saving_fulfillment_events',
  {
    id: uuidv7('id').primaryKey().notNull(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => savingOrders.id, { onDelete: 'restrict' }),
    stage: text('stage').notNull(),
    fromStatus: text('from_status').notNull(),
    toStatus: text('to_status').notNull(),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    explanation: text('explanation').notNull(),
    handoverDescription: text('handover_description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('saving_fulfillment_events_order_idx').on(table.orderId, table.createdAt, table.id),
    check(
      'saving_fulfillment_events_stage',
      sql`${table.stage} IN ('request_confirmation','product_delivery','installation_and_document_upload','equipment_handover','process_completion')`
    ),
    check(
      'saving_fulfillment_events_from_status',
      sql`${table.fromStatus} IN ('pending','in_progress','completed','skipped')`
    ),
    check(
      'saving_fulfillment_events_to_status',
      sql`${table.toStatus} IN ('in_progress','completed','skipped')`
    ),
    check(
      'saving_fulfillment_events_explanation',
      sql`length(trim(${table.explanation})) BETWEEN 1 AND 1000`
    ),
  ]
);

export const savingOrderSubmissions = pgTable(
  'saving_order_submissions',
  {
    id: uuidv7('id').primaryKey().notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    idempotencyKey: uuid('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => savingOrders.id, { onDelete: 'restrict' }),
    response: jsonb('response').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('saving_order_submission_user_key').on(table.userId, table.idempotencyKey),
  ]
);

export const savingOrderRevisions = pgTable(
  'saving_order_revisions',
  {
    id: uuidv7('id').primaryKey().notNull(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => savingOrders.id, { onDelete: 'restrict' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    idempotencyKey: uuid('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    previousVersionId: uuid('previous_version_id')
      .notNull()
      .references(() => contractVersions.id, { onDelete: 'restrict' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => contractVersions.id, { onDelete: 'restrict' }),
    previousSnapshot: jsonb('previous_snapshot').notNull(),
    response: jsonb('response').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('saving_order_revisions_user_key').on(table.userId, table.idempotencyKey),
    index('saving_order_revisions_order_idx').on(table.orderId, table.createdAt),
    check('saving_order_revisions_snapshot', sql`jsonb_typeof(${table.previousSnapshot})='object'`),
  ]
);

export const savingAddressAmendments = pgTable(
  'saving_address_amendments',
  {
    id: uuidv7('id').primaryKey().notNull(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => savingOrders.id, { onDelete: 'restrict' }),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id, { onDelete: 'restrict' }),
    contractVersionId: uuid('contract_version_id')
      .notNull()
      .references(() => contractVersions.id, { onDelete: 'restrict' }),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    previousAddressId: uuid('previous_address_id')
      .notNull()
      .references(() => addresses.id, { onDelete: 'restrict' }),
    addressId: uuid('address_id')
      .notNull()
      .references(() => addresses.id, { onDelete: 'restrict' }),
    previousSnapshot: jsonb('previous_snapshot').notNull(),
    addressSnapshot: jsonb('address_snapshot').notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('saving_address_amendments_order_idx').on(table.orderId, table.createdAt, table.id),
    check(
      'saving_address_amendments_distinct',
      sql`${table.previousAddressId}<>${table.addressId}`
    ),
    check(
      'saving_address_amendments_snapshots',
      sql`jsonb_typeof(${table.previousSnapshot})='object' AND jsonb_typeof(${table.addressSnapshot})='object'`
    ),
    check(
      'saving_address_amendments_reason',
      sql`length(trim(${table.reason})) BETWEEN 1 AND 1000`
    ),
  ]
);

export const savingHardwareAmendments = pgTable(
  'saving_hardware_amendments',
  {
    id: uuidv7('id').primaryKey().notNull(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => savingOrders.id, { onDelete: 'restrict' }),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id, { onDelete: 'restrict' }),
    contractVersionId: uuid('contract_version_id')
      .notNull()
      .references(() => contractVersions.id, { onDelete: 'restrict' }),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    previousHardwareId: uuid('previous_hardware_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    hardwareId: uuid('hardware_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    previousSnapshot: jsonb('previous_snapshot').notNull(),
    hardwareSnapshot: jsonb('hardware_snapshot').notNull(),
    originalInvoiceId: uuid('original_invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    adjustmentInvoiceId: uuid('adjustment_invoice_id').references(() => invoices.id, {
      onDelete: 'restrict',
    }),
    priceDeltaIrR: irrAmount('price_delta_irr')
      .notNull()
      .default(sql`'0'`),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('saving_hardware_amendments_order_idx').on(table.orderId, table.createdAt, table.id),
    check(
      'saving_hardware_amendments_distinct',
      sql`${table.previousHardwareId}<>${table.hardwareId}`
    ),
    check(
      'saving_hardware_amendments_snapshots',
      sql`jsonb_typeof(${table.previousSnapshot})='object' AND jsonb_typeof(${table.hardwareSnapshot})='object'`
    ),
    check(
      'saving_hardware_amendments_reason',
      sql`length(trim(${table.reason})) BETWEEN 1 AND 1000`
    ),
    check(
      'saving_hardware_amendments_adjustment_link',
      sql`(${table.priceDeltaIrR}=0 AND ${table.adjustmentInvoiceId} IS NULL) OR (${table.priceDeltaIrR}<>0 AND ${table.adjustmentInvoiceId} IS NOT NULL)`
    ),
  ]
);

export const savingHardwareUpgradeRequests = pgTable(
  'saving_hardware_upgrade_requests',
  {
    id: uuidv7('id').primaryKey().notNull(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => savingOrders.id, { onDelete: 'restrict' }),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id, { onDelete: 'restrict' }),
    contractVersionId: uuid('contract_version_id')
      .notNull()
      .references(() => contractVersions.id, { onDelete: 'restrict' }),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    previousHardwareId: uuid('previous_hardware_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    hardwareId: uuid('hardware_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    previousSnapshot: jsonb('previous_snapshot').notNull(),
    hardwareSnapshot: jsonb('hardware_snapshot').notNull(),
    originalInvoiceId: uuid('original_invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    adjustmentInvoiceId: uuid('adjustment_invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    priceDeltaIrR: irrAmount('price_delta_irr').notNull(),
    stockReserved: boolean('stock_reserved').notNull(),
    status: text('status').notNull().default('awaiting_payment'),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('saving_hardware_upgrade_invoice_key').on(table.adjustmentInvoiceId),
    uniqueIndex('saving_hardware_upgrade_pending_order_key')
      .on(table.orderId)
      .where(sql`${table.status}='awaiting_payment'`),
    index('saving_hardware_upgrade_order_idx').on(table.orderId, table.createdAt, table.id),
    check('saving_hardware_upgrade_positive_delta', sql`${table.priceDeltaIrR}>0`),
    check(
      'saving_hardware_upgrade_distinct',
      sql`${table.previousHardwareId}<>${table.hardwareId}`
    ),
    check(
      'saving_hardware_upgrade_snapshots',
      sql`jsonb_typeof(${table.previousSnapshot})='object' AND jsonb_typeof(${table.hardwareSnapshot})='object'`
    ),
    check('saving_hardware_upgrade_reason', sql`length(trim(${table.reason})) BETWEEN 1 AND 1000`),
    check(
      'saving_hardware_upgrade_status',
      sql`${table.status} IN ('awaiting_payment','applied','cancelled','expired')`
    ),
    check(
      'saving_hardware_upgrade_terminal_times',
      sql`(${table.status}='awaiting_payment' AND ${table.appliedAt} IS NULL AND ${table.closedAt} IS NULL) OR (${table.status}='applied' AND ${table.appliedAt} IS NOT NULL AND ${table.closedAt} IS NULL) OR (${table.status} IN ('cancelled','expired') AND ${table.appliedAt} IS NULL AND ${table.closedAt} IS NOT NULL)`
    ),
  ]
);

export const savingOrderComments = pgTable(
  'saving_order_comments',
  {
    id: uuidv7('id').primaryKey().notNull(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => savingOrders.id, { onDelete: 'restrict' }),
    authorUserId: text('author_user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('saving_order_comments_order_idx').on(table.orderId, table.createdAt, table.id),
    check('saving_order_comments_body', sql`length(trim(${table.body})) BETWEEN 1 AND 10000`),
  ]
);

export const savingInventoryReservations = pgTable(
  'saving_inventory_reservations',
  {
    id: uuidv7('id').primaryKey().notNull(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => savingOrders.id, { onDelete: 'restrict' }),
    hardwareProductId: uuid('hardware_product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('reserved'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    allocatedAt: timestamp('allocated_at', { withTimezone: true }),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('saving_inventory_reservation_order_key').on(table.orderId),
    index('saving_inventory_reservation_expiry_idx').on(table.status, table.expiresAt),
    check(
      'saving_inventory_reservation_status',
      sql`${table.status} IN ('reserved','allocated','expired','released')`
    ),
  ]
);
