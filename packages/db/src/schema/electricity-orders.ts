import {
  bigint as pgBigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { orders } from './orders';
import { profiles } from './profiles';
import { products } from './products';
import { users } from './users';
import { contracts } from './contracts';
import { invoices } from './invoices';
import { refunds } from './refunds';
import { uuidv7 } from '../types';

/** Electricity-specific draft data. Confirmation will add the period and priced lines. */
export const electricityOrders = pgTable(
  'electricity_orders',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => orders.id, { onDelete: 'restrict' }),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    mode: text('mode', { enum: ['simple', 'advanced'] })
      .notNull()
      .default('simple'),
    status: text('status', {
      enum: [
        'draft',
        'submitted',
        'awaiting_staff_review',
        'changes_requested',
        'approved',
        'active',
        'completed',
        'rejected',
        'cancelled',
      ],
    })
      .notNull()
      .default('draft'),
    settingsSnapshot: jsonb('settings_snapshot')
      .$type<{
        schemaVersion: 1;
        green: Record<string, unknown>;
        sourceVersion: number;
        contractLimits: Record<string, unknown>;
        contractLimitsVersion: number;
        capturedAt: string;
      }>()
      .notNull(),
    /** Set together with the submitted pricing snapshot, never while still a draft. */
    periodStart: timestamp('period_start', { withTimezone: true, mode: 'date' }),
    periodEnd: timestamp('period_end', { withTimezone: true, mode: 'date' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'date' }),
    pricingSnapshot: jsonb('pricing_snapshot').$type<Record<string, unknown>>(),
    totalKwh: pgBigint('total_kwh', { mode: 'bigint' }),
    averagePowerKw: numeric('average_power_kw', { precision: 30, scale: 9 }),
    greenRuleApplied: boolean('green_rule_applied'),
    submittedBy: text('submitted_by').references(() => users.userId, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('electricity_orders_status_idx').on(table.status),
    check('electricity_orders_mode', sql`${table.mode} IN ('simple', 'advanced')`),
    check(
      'electricity_orders_status',
      sql`${table.status} IN ('draft', 'submitted', 'awaiting_staff_review', 'changes_requested', 'approved', 'active', 'completed', 'rejected', 'cancelled')`
    ),
    check(
      'electricity_orders_settings_snapshot_object',
      sql`jsonb_typeof(${table.settingsSnapshot}) = 'object'`
    ),
    check(
      'electricity_orders_period_range',
      sql`${table.periodStart} IS NULL OR ${table.periodEnd} > ${table.periodStart}`
    ),
    check(
      'electricity_orders_pricing_snapshot_object',
      sql`${table.pricingSnapshot} IS NULL OR jsonb_typeof(${table.pricingSnapshot}) = 'object'`
    ),
  ]
);

export type ElectricityOrder = typeof electricityOrders.$inferSelect;
export type NewElectricityOrder = typeof electricityOrders.$inferInsert;

/** Public replies and staff-only notes on submitted electricity orders. */
export const electricityOrderComments = pgTable(
  'electricity_order_comments',
  {
    id: uuidv7('id').primaryKey().notNull(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => electricityOrders.id, { onDelete: 'restrict' }),
    authorUserId: text('author_user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    visibility: text('visibility', { enum: ['public', 'internal'] }).notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('electricity_order_comments_order_idx').on(table.orderId, table.createdAt, table.id),
    index('electricity_order_comments_recent_idx').on(table.createdAt.desc(), table.id.desc()),
    check(
      'electricity_order_comments_visibility',
      sql`${table.visibility} IN ('public','internal')`
    ),
    check('electricity_order_comments_body', sql`length(trim(${table.body})) BETWEEN 1 AND 10000`),
  ]
);

/** Frozen order composition; a zero-quantity product has no line. */
export const electricityOrderLines = pgTable(
  'electricity_order_lines',
  {
    id: uuidv7('id').primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => electricityOrders.id, { onDelete: 'restrict' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    quantityKwh: pgBigint('quantity_kwh', { mode: 'bigint' }).notNull(),
    unitPrice: pgBigint('unit_price', { mode: 'bigint' }).notNull(),
    lineTotal: pgBigint('line_total', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('electricity_order_lines_product_unique').on(table.orderId, table.productId),
    index('electricity_order_lines_order_idx').on(table.orderId),
    check('electricity_order_lines_quantity_positive', sql`${table.quantityKwh} > 0`),
    check(
      'electricity_order_lines_money_nonnegative',
      sql`${table.unitPrice} > 0 AND ${table.lineTotal} >= 0`
    ),
  ]
);

/** One contract relation for each submitted electricity order. */
export const electricityContracts = pgTable(
  'electricity_contracts',
  {
    id: uuidv7('id').primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => electricityOrders.id, { onDelete: 'restrict' }),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id, { onDelete: 'restrict' }),
    status: text('status', { enum: ['draft', 'active', 'completed', 'cancelled'] })
      .notNull()
      .default('draft'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('electricity_contracts_order_unique').on(table.orderId),
    uniqueIndex('electricity_contracts_contract_unique').on(table.contractId),
    check(
      'electricity_contracts_status',
      sql`${table.status} IN ('draft', 'active', 'completed', 'cancelled')`
    ),
  ]
);

/** Completed idempotency results; a retry reads the original immutable response. */
export const electricityOrderSubmissions = pgTable(
  'electricity_order_submissions',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    idempotencyKey: uuid('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => electricityOrders.id, { onDelete: 'restrict' }),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id, { onDelete: 'restrict' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    response: jsonb('response')
      .$type<{ orderId: string; contractId: string; invoiceId: string }>()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.idempotencyKey],
      name: 'electricity_order_submissions_pk',
    }),
  ]
);

/** Server-owned customer progress; deleted in the same transaction as final submission. */
export const electricityCustomerDrafts = pgTable(
  'electricity_customer_drafts',
  {
    id: uuidv7('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    mode: text('mode', { enum: ['simple', 'advanced'] }).notNull(),
    currentStep: integer('current_step').notNull().default(1),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('electricity_customer_drafts_owner_unique').on(
      table.userId,
      table.profileId,
      table.mode
    ),
    check('electricity_customer_drafts_step', sql`${table.currentStep} BETWEEN 1 AND 5`),
    check('electricity_customer_drafts_data_object', sql`jsonb_typeof(${table.data}) = 'object'`),
  ]
);

/** A paid rejected order owns a durable, idempotent refund obligation. */
export const refundObligations = pgTable(
  'refund_obligations',
  {
    id: uuidv7('id').primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    contractId: uuid('contract_id').references(() => contracts.id, { onDelete: 'restrict' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    refundId: uuid('refund_id')
      .notNull()
      .references(() => refunds.id, { onDelete: 'restrict' }),
    totalPaidAmount: pgBigint('total_paid_amount', { mode: 'bigint' }).notNull(),
    completedRefundAmount: pgBigint('completed_refund_amount', { mode: 'bigint' })
      .notNull()
      .default(sql`0::bigint`),
    status: text('status', { enum: ['pending', 'processing', 'completed', 'failed'] })
      .notNull()
      .default('pending'),
    idempotencyKey: text('idempotency_key').notNull(),
    authorizedBy: text('authorized_by')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('refund_obligations_order_unique').on(table.orderId),
    uniqueIndex('refund_obligations_refund_unique').on(table.refundId),
    uniqueIndex('refund_obligations_idempotency_unique').on(table.idempotencyKey),
    index('refund_obligations_status_idx').on(table.status, table.createdAt),
    check(
      'refund_obligations_status_check',
      sql`${table.status} IN ('pending','processing','completed','failed')`
    ),
    check(
      'refund_obligations_amount_check',
      sql`${table.totalPaidAmount} > 0 AND ${table.completedRefundAmount} >= 0 AND ${table.completedRefundAmount} <= ${table.totalPaidAmount}`
    ),
    check('refund_obligations_reason_check', sql`length(trim(${table.reason})) > 0`),
  ]
);
