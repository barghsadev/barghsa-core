import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { baseColumns } from '../base-table'
import { irrAmount, timestamptz, uuidv7 } from '../types'
import { invoices } from './invoices'
import { profiles } from './profiles'
import { users } from './users'

/**
 * Bank-receipt lifecycle (S-04.3.01 / T-04.3.01.01).
 *
 * Must stay in lock-step with `chk_bank_receipts_state` in migration 0078.
 *
 * Submitted → UnderReview → Confirmed | Rejected
 * Confirm and reject are also allowed directly from Submitted.
 */
export const BANK_RECEIPT_STATES = [
  'Submitted',
  'UnderReview',
  'Confirmed',
  'Rejected',
] as const
export type BankReceiptState = (typeof BANK_RECEIPT_STATES)[number]

/**
 * Invoice bank-receipt evidence (T-04.3.01.01 / S-04.3.01).
 *
 * Customers submit a receipt against an invoice; finance staff later
 * confirms or rejects it. Confirmation, wallet overpayment credit, and
 * invoice settlement are later tasks — this table is the durable row.
 *
 * Columns:
 *   - `id` — UUIDv7 primary key.
 *   - `invoiceId` / `profileId` — composite FK → invoices(id, profile_id)
 *     (RESTRICT) so a receipt cannot attach to another profile's invoice.
 *     `profileId` also FKs → profiles.id (RESTRICT).
 *   - `amount` — positive int8 IRR.
 *   - `paymentDate` — calendar date of the bank transfer (`YYYY-MM-DD`).
 *   - `payerReference` — bank slip / tracking reference.
 *   - `attachmentKey` — object-storage key for the uploaded scan.
 *   - `customerNote` — optional customer note.
 *   - `state` — Submitted | UnderReview | Confirmed | Rejected.
 *   - `confirmedBy?` / `confirmedAt?` — set together iff Confirmed.
 *   - `rejectionReason?` — set iff Rejected.
 *   - `createdAt` / `updatedAt` — audit columns.
 *
 * CHECKs, lookup indexes, the unique attachment index, the
 * composite `(invoice_id, profile_id)` FK, the `confirmed_by` →
 * `users` FK, and the `updated_at` trigger live in migration 0078.
 */
export const bankReceipts = pgTable(
  'bank_receipts',
  {
    ...baseColumns,

    /**
     * Invoice this receipt is offered against. Bound to `profileId`
     * via `fk_bank_receipts_invoice_profile` (composite FK).
     */
    invoiceId: uuidv7('invoice_id').notNull(),

    /** Customer profile that submitted the receipt. Must own the invoice. */
    profileId: uuidv7('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),

    /** Claimed transfer amount in IRR (int8). Must be positive. */
    amount: irrAmount('amount').notNull(),

    /** Calendar date printed on the bank slip. */
    paymentDate: date('payment_date', { mode: 'string' }).notNull(),

    /** Payer / tracking reference from the bank slip. */
    payerReference: text('payer_reference').notNull(),

    /**
     * Object-storage key for the uploaded scan. Unique so one file
     * cannot back two invoice receipts.
     */
    attachmentKey: text('attachment_key').notNull(),

    /** Optional customer note. Blank submissions store NULL. */
    customerNote: text('customer_note'),

    /** Receipt lifecycle state. Default Submitted. */
    state: text('state', {
      enum: BANK_RECEIPT_STATES,
    })
      .notNull()
      .default('Submitted'),

    /** Finance staff who confirmed the receipt. NULL until Confirmed. */
    confirmedBy: text('confirmed_by').references(() => users.userId, {
      onDelete: 'restrict',
    }),

    /** When the receipt was confirmed. NULL until Confirmed. */
    confirmedAt: timestamptz('confirmed_at'),

    /** Staff rejection reason. NULL until Rejected. */
    rejectionReason: text('rejection_reason'),
  },
  (table) => ({
    amountPositive: check('chk_bank_receipts_amount_positive', sql`${table.amount} > 0`),
    stateCheck: check(
      'chk_bank_receipts_state',
      sql`${table.state} IN ('Submitted', 'UnderReview', 'Confirmed', 'Rejected')`,
    ),
    payerReferenceNonblank: check(
      'chk_bank_receipts_payer_reference_nonblank',
      sql`length(trim(${table.payerReference})) > 0`,
    ),
    attachmentKeyNonblank: check(
      'chk_bank_receipts_attachment_key_nonblank',
      sql`length(trim(${table.attachmentKey})) > 0`,
    ),
    /**
     * Confirmation columns are set together only on Confirmed;
     * rejection reason is set only on Rejected; in-flight rows keep
     * all three NULL.
     */
    stateFields: check(
      'chk_bank_receipts_state_fields',
      sql`(
        (
          ${table.state} = 'Confirmed'
          AND ${table.confirmedBy} IS NOT NULL
          AND ${table.confirmedAt} IS NOT NULL
          AND ${table.rejectionReason} IS NULL
        )
        OR (
          ${table.state} = 'Rejected'
          AND ${table.rejectionReason} IS NOT NULL
          AND length(trim(${table.rejectionReason})) > 0
          AND ${table.confirmedBy} IS NULL
          AND ${table.confirmedAt} IS NULL
        )
        OR (
          ${table.state} IN ('Submitted', 'UnderReview')
          AND ${table.confirmedBy} IS NULL
          AND ${table.confirmedAt} IS NULL
          AND ${table.rejectionReason} IS NULL
        )
      )`,
    ),
    invoiceIdIdx: index('idx_bank_receipts_invoice_id').on(table.invoiceId),
    profileIdIdx: index('idx_bank_receipts_profile_id').on(table.profileId),
    stateIdx: index('idx_bank_receipts_state').on(table.state),
    attachmentUnique: uniqueIndex('uq_bank_receipts_attachment_key').on(table.attachmentKey),
    /**
     * Receipt profile must own the referenced invoice (T-04.3.01.01).
     * Independent invoice_id / profile_id FKs would accept a cross-tenant
     * pair; this composite FK rejects it. Requires uq_invoices_id_profile_id.
     */
    invoiceProfileFk: foreignKey({
      name: 'fk_bank_receipts_invoice_profile',
      columns: [table.invoiceId, table.profileId],
      foreignColumns: [invoices.id, invoices.profileId],
    }).onDelete('restrict'),
  }),
)

/**
 * SQL to create the bank_receipts table (migration 0078 source).
 */
export const createBankReceiptsTable = sql`
  CREATE TABLE IF NOT EXISTS bank_receipts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    invoice_id UUID NOT NULL,
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    amount BIGINT NOT NULL
      CONSTRAINT chk_bank_receipts_amount_positive
        CHECK (amount > 0),
    payment_date DATE NOT NULL,
    payer_reference TEXT NOT NULL
      CONSTRAINT chk_bank_receipts_payer_reference_nonblank
        CHECK (length(trim(payer_reference)) > 0),
    attachment_key TEXT NOT NULL
      CONSTRAINT chk_bank_receipts_attachment_key_nonblank
        CHECK (length(trim(attachment_key)) > 0),
    customer_note TEXT,
    state TEXT NOT NULL DEFAULT 'Submitted'
      CONSTRAINT chk_bank_receipts_state
        CHECK (state IN ('Submitted', 'UnderReview', 'Confirmed', 'Rejected')),
    confirmed_by TEXT,
    confirmed_at TIMESTAMPTZ,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_bank_receipts_state_fields CHECK (
      (
        state = 'Confirmed'
        AND confirmed_by IS NOT NULL
        AND confirmed_at IS NOT NULL
        AND rejection_reason IS NULL
      )
      OR (
        state = 'Rejected'
        AND rejection_reason IS NOT NULL
        AND length(trim(rejection_reason)) > 0
        AND confirmed_by IS NULL
        AND confirmed_at IS NULL
      )
      OR (
        state IN ('Submitted', 'UnderReview')
        AND confirmed_by IS NULL
        AND confirmed_at IS NULL
        AND rejection_reason IS NULL
      )
    ),
    CONSTRAINT fk_bank_receipts_invoice_profile
      FOREIGN KEY (invoice_id, profile_id)
      REFERENCES invoices(id, profile_id) ON DELETE RESTRICT,
    CONSTRAINT fk_bank_receipts_confirmed_by
      FOREIGN KEY (confirmed_by) REFERENCES users(user_id) ON DELETE RESTRICT
  );

  CREATE INDEX IF NOT EXISTS idx_bank_receipts_invoice_id ON bank_receipts (invoice_id);
  CREATE INDEX IF NOT EXISTS idx_bank_receipts_profile_id ON bank_receipts (profile_id);
  CREATE INDEX IF NOT EXISTS idx_bank_receipts_state ON bank_receipts (state);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_receipts_attachment_key
    ON bank_receipts (attachment_key);

  CREATE OR REPLACE FUNCTION update_bank_receipts_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $$
  BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
  END;
  $$;

  DROP TRIGGER IF EXISTS trg_bank_receipts_updated_at ON bank_receipts;

  CREATE TRIGGER trg_bank_receipts_updated_at
    BEFORE UPDATE ON bank_receipts
    FOR EACH ROW
    EXECUTE FUNCTION update_bank_receipts_updated_at();
`
