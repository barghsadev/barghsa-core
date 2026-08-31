import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  jsonb,
  text,
  pgTable,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { pgEnum, uuidv7, irrAmount, timestamptz } from '../types'
import { profiles } from './profiles'
import { orders } from './orders'

/**
 * Invoice state enum (T-04.1.01.02).
 *
 * Nine states covering the complete invoice lifecycle:
 *   Draft → Unpaid → Payment under review → Partially funded → Paid →
 *   Overdue → Cancelled → Partially refunded → Refunded
 */
export const invoiceStateEnum = pgEnum('invoice_state', [
  'Draft',
  'Unpaid',
  'PaymentUnderReview',
  'PartiallyFunded',
  'Paid',
  'Overdue',
  'Cancelled',
  'PartiallyRefunded',
  'Refunded',
])

/**
 * Invoice table (T-04.1.01.01).
 *
 * Tracks the complete lifecycle of every invoice through 9 states.
 *
 * All monetary amounts are stored as signed 64-bit integers (IRR, Rials).
 * Floating-point arithmetic is strictly forbidden.
 *
 * Columns:
 *   - `id` — UUIDv7 primary key.
 *   - `profileId` — FK → profiles.id (the customer).
 *   - `orderId?` — optional FK → orders.id.
 *   - `contractId?` — optional text reference (contracts table TBD).
 *   - `consultationId?` — optional text reference (consultations table TBD).
 *   - `state` — current invoice state (invoice_state enum).
 *   - `totalAmount` — int8; invoice total in IRR.
 *   - `paidAmount` — int8, default 0; cumulative confirmed payments.
 *   - `refundedAmount` — int8, default 0; cumulative refunds.
 *   - `issuedAt` — when the invoice was issued (set on Draft→Unpaid).
 *   - `payableFrom` — earliest date the invoice can be paid.
 *   - `dueAt` — payment deadline.
 *   - `cancelledAt?` — when the invoice was cancelled (if applicable).
 *   - `metadata` — JSONB for extensible structured data snapshots.
 *   - `invoiceCalculationSnapshot` — JSONB of calculation inputs,
 *     intermediate rounding steps, and final totals (T-04.1.02.08).
 *     Nullable so legacy rows remain valid; new invoices populate it.
 *   - `replacesInvoiceId?` — nullable self-FK to the cancelled invoice
 *     this row replaces (pre-payment cancel+replace, T-04.1.05.01).
 *   - `adjustmentForInvoiceId?` — nullable self-FK to the paid invoice
 *     this row adjusts (post-payment adjustment, T-04.1.05.01).
 *   - `adjustmentKind?` — `'charge'` | `'credit'` on adjustment rows;
 *     NULL on ordinary invoices (T-04.1.05.03).
 *   - `accountingAmount` — signed IRR contribution to customer
 *     liability (generated: `-total_amount` for credits).
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
     * Optional reference to a contract (T-04.1.02.05).
     * FK deferred until the contracts table is defined.
     */
    contractId: text('contract_id'),

    /**
     * Optional reference to a consultation (T-04.1.02.05).
     * FK deferred until the consultations table is defined, mirroring the
     * contractId pattern — the column carries the origin reference from day
     * one, and the actual FK constraint is added in the epic that creates
     * the consultations table.
     */
    consultationId: text('consultation_id'),

    /**
     * Invoice source/kind discriminator (T-04.1.02.06).
     * `'auto'` (system-generated from an order) or `'manual'` (staff
     * created), with future contract / consultation kinds as the owning
     * epics land. Backs the idempotency unique index on
     * `(order_id, type)` so an order can produce at most one ordinary
     * (non-correction) auto invoice. Correction replacements set
     * `replaces_invoice_id` and adjustments set `adjustment_for_invoice_id`;
     * both are excluded from that index (T-04.1.05.02 / T-04.1.05.03).
     * Nullable: order-less manuals never collide.
     */
    type: text('type'),

    /** Current invoice state (invoice_state enum). */
    state: invoiceStateEnum('state').notNull().default('Draft'),

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

    /** When the invoice entered `Paid` (PayFromWallet or ConfirmBankReceipt). */
    paidAt: timestamptz('paid_at'),

    /** When the invoice entered `Overdue` (MarkOverdue). */
    overdueAt: timestamptz('overdue_at'),

    /** Extensible metadata payload for snapshots and auxiliary data. */
    metadata: jsonb('metadata'),

    /**
     * Canonical calculation snapshot (T-04.1.02.08).
     *
     * JSON object recording every input, each VAT half-up rounding step,
     * and the final totals so the invoice can be reproduced later
     * (T-04.1.02.09). Amounts are decimal-digit strings (bigint IRR).
     * Nullable: pre-existing rows have no snapshot.
     */
    invoiceCalculationSnapshot: jsonb('invoice_calculation_snapshot'),

    /**
     * Cancel+replace link (T-04.1.05.01 / S-04.1.05).
     *
     * The corrected invoice stores the id of the cancelled original it
     * replaces. Nullable: ordinary invoices have no predecessor.
     * FK is declared below (self-reference via `foreignKey`) and in
     * migration 0064 — `ON DELETE RESTRICT` so an original cannot be
     * dropped while a replacement still points at it.
     */
    replacesInvoiceId: uuid('replaces_invoice_id'),

    /**
     * Adjustment invoice link (T-04.1.05.01 / S-04.1.05).
     *
     * A post-payment adjustment (positive charge or negative credit)
     * stores the id of the paid invoice it adjusts. Nullable: ordinary
     * invoices are not adjustments. Same RESTRICT self-FK as
     * `replacesInvoiceId`.
     */
    adjustmentForInvoiceId: uuid('adjustment_for_invoice_id'),

    /**
     * First-class adjustment discriminator (T-04.1.05.03).
     *
     * `'charge'` = additional customer payable; `'credit'` = credit note
     * that reduces net liability and is excluded from payment flow.
     * NULL on ordinary (non-adjustment) invoices. Migration 0067 adds
     * the column and a NOT VALID kind/link CHECK; VALIDATE is a later
     * contract-phase migration after old writers are retired.
     */
    adjustmentKind: text('adjustment_kind'),

    /**
     * Signed IRR contribution to customer liability (T-04.1.05.03).
     *
     * Generated in migration 0067: `-total_amount` when
     * `adjustment_kind = 'credit'`, otherwise `total_amount`. Ordinary
     * invoices therefore match `total_amount`; credits cannot be
     * mistaken for unpaid debt by amount-based outstanding queries.
     */
    accountingAmount: irrAmount('accounting_amount'),

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
    /**
     * Idempotency: an order produces at most one ordinary (non-correction)
     * invoice of a given type (T-04.1.02.06 / T-04.1.05.02 / T-04.1.05.03).
     * Correction-chain rows set `replaces_invoice_id` or
     * `adjustment_for_invoice_id` and are excluded so cancel+replace and
     * createAdjustmentInvoice can copy `order_id` without colliding with
     * the original or a sibling invoice of type `manual`.
     * Created by migration 0057; predicate rewritten by 0065 then 0066.
     */
    orderIdTypeUnique: uniqueIndex('uq_invoices_order_id_type')
      .on(table.orderId, table.type)
      .where(
        sql`${table.replacesInvoiceId} IS NULL AND ${table.adjustmentForInvoiceId} IS NULL`,
      ),
    /**
     * Self-FK: replacement invoice → cancelled original (T-04.1.05.01).
     * Declared here rather than on the column to avoid circular type
     * inference on the table initializer.
     */
    replacesInvoiceFk: foreignKey({
      name: 'invoices_replaces_invoice_id_fkey',
      columns: [table.replacesInvoiceId],
      foreignColumns: [table.id],
    }).onDelete('restrict'),
    /**
     * Self-FK: adjustment invoice → paid original (T-04.1.05.01).
     */
    adjustmentForInvoiceFk: foreignKey({
      name: 'invoices_adjustment_for_invoice_id_fkey',
      columns: [table.adjustmentForInvoiceId],
      foreignColumns: [table.id],
    }).onDelete('restrict'),
    /**
     * Adjustment rows must declare charge vs credit; ordinary rows
     * must not (T-04.1.05.03). Migration 0067 adds this CHECK as
     * NOT VALID; VALIDATE is a later contract-phase migration.
     */
    adjustmentKindMatchesLink: check(
      'ck_invoices_adjustment_kind_matches_link',
      sql`(
        (${table.adjustmentForInvoiceId} IS NULL) = (${table.adjustmentKind} IS NULL)
        AND (
          ${table.adjustmentKind} IS NULL
          OR ${table.adjustmentKind} IN ('charge', 'credit')
        )
      )`,
    ),
    replacesInvoiceIdIdx: index('idx_invoices_replaces_invoice_id').on(
      table.replacesInvoiceId,
    ),
    adjustmentForInvoiceIdIdx: index('idx_invoices_adjustment_for_invoice_id').on(
      table.adjustmentForInvoiceId,
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
    consultation_id TEXT,
    type TEXT,
    state invoice_state NOT NULL DEFAULT 'Draft',
    total_amount BIGINT NOT NULL CHECK (total_amount >= 0),
    paid_amount BIGINT NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    refunded_amount BIGINT NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
    issued_at TIMESTAMPTZ,
    payable_from TIMESTAMPTZ,
    due_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    overdue_at TIMESTAMPTZ,
    metadata JSONB,
    invoice_calculation_snapshot JSONB,
    replaces_invoice_id UUID REFERENCES invoices(id) ON DELETE RESTRICT,
    adjustment_for_invoice_id UUID REFERENCES invoices(id) ON DELETE RESTRICT,
    adjustment_kind TEXT CHECK (adjustment_kind IS NULL OR adjustment_kind IN ('charge', 'credit')),
    accounting_amount BIGINT GENERATED ALWAYS AS (
      CASE WHEN adjustment_kind = 'credit' THEN -total_amount ELSE total_amount END
    ) STORED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_paid_not_exceeds_total CHECK (paid_amount <= total_amount),
    CONSTRAINT ck_refund_not_exceeds_paid CHECK (refunded_amount <= paid_amount),
    -- Greenfield CREATE has no existing rows, so this CHECK is validated.
    -- Migration 0067 adds the same constraint as NOT VALID on upgrade.
    CONSTRAINT ck_invoices_adjustment_kind_matches_link CHECK (
      (adjustment_for_invoice_id IS NULL) = (adjustment_kind IS NULL)
      AND (
        adjustment_kind IS NULL
        OR adjustment_kind IN ('charge', 'credit')
      )
    )
  );

  CREATE INDEX IF NOT EXISTS idx_invoices_profile_id ON invoices (profile_id);
  CREATE INDEX IF NOT EXISTS idx_invoices_state ON invoices (state);
  CREATE INDEX IF NOT EXISTS idx_invoices_due_at ON invoices (due_at);
  CREATE INDEX IF NOT EXISTS idx_invoices_order_id ON invoices (order_id);
  CREATE INDEX IF NOT EXISTS idx_invoices_contract_id ON invoices (contract_id);
  CREATE INDEX IF NOT EXISTS idx_invoices_consultation_id ON invoices (consultation_id);
  CREATE INDEX IF NOT EXISTS idx_invoices_replaces_invoice_id
    ON invoices (replaces_invoice_id);
  CREATE INDEX IF NOT EXISTS idx_invoices_adjustment_for_invoice_id
    ON invoices (adjustment_for_invoice_id);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_order_id_type
    ON invoices (order_id, type)
    WHERE replaces_invoice_id IS NULL AND adjustment_for_invoice_id IS NULL;
`
