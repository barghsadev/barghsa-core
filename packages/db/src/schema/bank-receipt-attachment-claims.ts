import { sql } from 'drizzle-orm'
import { check, pgTable, text } from 'drizzle-orm/pg-core'
import { timestamptz } from '../types'

/**
 * Cross-flow bank-receipt attachment claims (T-04.3.01.02).
 *
 * Must stay in lock-step with `chk_bank_receipt_attachment_claims_type`
 * in migration 0079.
 *
 * One `storage_key` is owned by either a wallet top-up or an invoice
 * receipt. Same-flow retries reuse the row; the other flow is rejected.
 */
export const BANK_RECEIPT_ATTACHMENT_CLAIM_TYPES = [
  'wallet_topup',
  'invoice_receipt',
] as const
export type BankReceiptAttachmentClaimType =
  (typeof BANK_RECEIPT_ATTACHMENT_CLAIM_TYPES)[number]

/**
 * Durable claim that a storage object backs exactly one payment flow.
 *
 * Columns:
 *   - `storageKey` — object-storage key; primary unique identity.
 *   - `claimType` — wallet_topup | invoice_receipt.
 *   - `createdAt` / `updatedAt` — audit columns.
 *
 * CHECKs, the updated_at trigger, and backfill from existing wallet
 * and invoice attachment keys live in migration 0079.
 */
export const bankReceiptAttachmentClaims = pgTable(
  'bank_receipt_attachment_claims',
  {
    /** Object-storage key. Unique so one file cannot back two flows. */
    storageKey: text('storage_key').primaryKey().notNull(),

    /** Flow that claimed the key. */
    claimType: text('claim_type', {
      enum: BANK_RECEIPT_ATTACHMENT_CLAIM_TYPES,
    }).notNull(),

    createdAt: timestamptz('created_at').defaultNow().notNull(),

    updatedAt: timestamptz('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    storageKeyNonblank: check(
      'chk_bank_receipt_attachment_claims_storage_key_nonblank',
      sql`length(trim(${table.storageKey})) > 0`,
    ),
    claimTypeCheck: check(
      'chk_bank_receipt_attachment_claims_type',
      sql`${table.claimType} IN ('wallet_topup', 'invoice_receipt')`,
    ),
  }),
)

/**
 * SQL to create the bank_receipt_attachment_claims table
 * (migration 0079 source).
 */
export const createBankReceiptAttachmentClaimsTable = sql`
  CREATE TABLE IF NOT EXISTS bank_receipt_attachment_claims (
    storage_key TEXT PRIMARY KEY
      CONSTRAINT chk_bank_receipt_attachment_claims_storage_key_nonblank
        CHECK (length(trim(storage_key)) > 0),
    claim_type TEXT NOT NULL
      CONSTRAINT chk_bank_receipt_attachment_claims_type
        CHECK (claim_type IN ('wallet_topup', 'invoice_receipt')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE OR REPLACE FUNCTION update_bank_receipt_attachment_claims_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $$
  BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
  END;
  $$;

  DROP TRIGGER IF EXISTS trg_bank_receipt_attachment_claims_updated_at
    ON bank_receipt_attachment_claims;

  CREATE TRIGGER trg_bank_receipt_attachment_claims_updated_at
    BEFORE UPDATE ON bank_receipt_attachment_claims
    FOR EACH ROW
    EXECUTE FUNCTION update_bank_receipt_attachment_claims_updated_at();
`
