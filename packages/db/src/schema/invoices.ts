import { sql } from 'drizzle-orm'
import { check, text, jsonb, pgTable } from 'drizzle-orm/pg-core'
import { uuidv7, irrAmount, timestamptz } from '../types'
import { profiles } from './profiles'
import { orders } from './orders'

/**
 * Invoice table (T-04.1.01.01).
 *
 * Tracks the complete lifecycle of every invoice through 9 states:
 *   Draft → Unpaid → Payment under review → Partially funded → Paid →
 *   Overdue → Cancelled → Partially refunded → Refunded
 *
 * All monetary amounts are stored as signed 64-bit integers (IRR, Rials).
 * Floating-point arithmetic is strictly forbidden.
 *
 * Columns:
 *   - `id` — UUIDv7 primary key.
 *   - `profileId` — FK → profiles.id (the customer).
 *   - `orderId?` — optional FK → orders.id.
 *   - `contractId?` — optional text reference (contracts table TBD).
 *   - `state` — current invoice state (9-state enum).
 *   - `totalAmount` — int8; invoice total in IRR.
 *   - `paidAmount` — int8, default 0; cumulative confirmed payments.
 *   - `refundedAmount` — int8, default 0; cumulative refunds.
 *   - `issuedAt` — when the invoice was issued (set on Draft→Unpaid).
 *   - `payableFrom` — earliest date the invoice can be paid.
 *   - `dueAt` — payment deadline.
 *   - `cancelledAt?` — when the invoice was cancelled (if applicable).
 *   - `metadata` — JSONB for extensible structured data snapshots.
 *   - `createdAt` / `updatedAt` — audit columns (from baseColumns).
 */
export const invoices = pgTable(
  'invoices',
  {
    /** UUIDv7 opaque invoice identifier. */
    id: uuidv7('id').primaryKey().notNull(),

    /** Foreign key to the customer profile. */
    profileId: uuidv7('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),

    /** Optional foreign key to the originating order. */
    orderId: uuidv7('order_id')
      .references(() => orders.id, { onDelete: 'set null' }),

    /**
     * Optional reference to a contract.
     * FK deferred until the contracts table is defined.
     */
    contractId: text('contract_id'),

    /**
     * Current invoice state.
     *
     * Nine states covering the full lifecycle:
     *   Draft, Unpaid, PaymentUnderReview, PartiallyFunded, Paid,
     *   Overdue, Cancelled, PartiallyRefunded, Refunded
     */
    state: text('state', {
      enum: [
        'Draft',
        'Unpaid',
        'PaymentUnderReview',
        'PartiallyFunded',
        'Paid',
        'Overdue',
        'Cancelled',
        'PartiallyRefunded',
        'Refunded',
      ],
    })
      .notNull()
      .default('Draft'),

    /** Invoice total amount in IRR (int8). Never negative. */
    totalAmount: irrAmount('total_amount').notNull(),

    /** Cumulative confirmed payment amount in IRR. Default 0. */
    paidAmount: irrAmount('paid_amount').notNull().default(sql`0::bigint`),

    /** Cumulative refund amount in IRR. Default 0. */
    refundedAmount: irrAmount('refunded_amount').notNull().default(sql`0::bigint`),

    /** When the invoice was issued (Draft→Unpaid transition). */
    issuedAt: timestamptz('issued_at'),

    /** Earliest date the invoice can be paid. */
    payableFrom: timestamptz('payable_from'),

    /** Payment deadline. */
    dueAt: timestamptz('due_at'),

    /** When the invoice was cancelled (if applicable). */
    cancelledAt: timestamptz('cancelled_at'),

    /** Extensible metadata payload for snapshots and auxiliary data. */
    metadata: jsonb('metadata'),

    /** When the invoice record was created. */
    createdAt: timestamptz('created_at')
      .defaultNow()
      .notNull(),

    /** When the invoice record was last updated. */
    updatedAt: timestamptz('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    /** paidAmount must not exceed the invoice total. */
    paidNotExceedsTotal: check(
      'ck_paid_not_exceeds_total',
      sql`${table.paidAmount} <= ${table.totalAmount}`,
    ),
    /** refundedAmount must not exceed the cumulative paid amount. */
    refundNotExceedsPaid: check(
      'ck_refund_not_exceeds_paid',
      sql`${table.refundedAmount} <= ${table.paidAmount}`,
    ),
  }),
)

/**
 * SQL to create the invoices table with CHECK constraints.
 *
 * This is the migration source of truth. The Drizzle pgTable above
 * mirrors these constraints for ORM query type safety; the raw SQL
 * is what actually runs against PostgreSQL.
 *
 * Constraints enforced at the database level:
 *   - paidAmount <= totalAmount
 *   - refundedAmount <= paidAmount
 */
export const createInvoicesTable = sql`
  CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    contract_id TEXT,
    state TEXT NOT NULL DEFAULT 'Draft' CHECK (state IN (
      'Draft', 'Unpaid', 'PaymentUnderReview', 'PartiallyFunded',
      'Paid', 'Overdue', 'Cancelled', 'PartiallyRefunded', 'Refunded'
    )),
    total_amount BIGINT NOT NULL CHECK (total_amount >= 0),
    paid_amount BIGINT NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    refunded_amount BIGINT NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
    issued_at TIMESTAMPTZ,
    payable_from TIMESTAMPTZ,
    due_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_paid_not_exceeds_total CHECK (paid_amount <= total_amount),
    CONSTRAINT ck_refund_not_exceeds_paid CHECK (refunded_amount <= paid_amount)
  );

  CREATE INDEX IF NOT EXISTS idx_invoices_profile_id ON invoices (profile_id);
  CREATE INDEX IF NOT EXISTS idx_invoices_state ON invoices (state);
  CREATE INDEX IF NOT EXISTS idx_invoices_due_at ON invoices (due_at);
  CREATE INDEX IF NOT EXISTS idx_invoices_order_id ON invoices (order_id);
`