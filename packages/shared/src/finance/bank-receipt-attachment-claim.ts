/**
 * Shared bank-receipt attachment claim contract (T-04.3.01.02).
 *
 * Wallet top-up and invoice-payment uploads both freeze a
 * `storage_records` object. Uniqueness inside each table is not enough:
 * the same key must be claimed by at most one flow. Both services take
 * the same advisory lock and insert into `bank_receipt_attachment_claims`
 * before writing their domain row.
 *
 * @module finance
 */

/** Claim owners stored on `bank_receipt_attachment_claims.claim_type`. */
export const BANK_RECEIPT_ATTACHMENT_CLAIM_TYPES = [
  'wallet_topup',
  'invoice_receipt',
] as const

export type BankReceiptAttachmentClaimType =
  (typeof BANK_RECEIPT_ATTACHMENT_CLAIM_TYPES)[number]

/**
 * Advisory-lock namespace shared by wallet top-up and invoice receipt
 * submission. Server-side SHA-256 of this prefix plus the storage key
 * produces the `pg_advisory_lock` pair; keep hashing off this package
 * so the finance barrel stays browser-safe.
 */
export const BANK_RECEIPT_ATTACHMENT_LOCK_NAMESPACE = 'bank-receipt-attachment'

export type BankReceiptAttachmentClaimVerdict =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'other_flow' }

/**
 * Decide whether a locked claim row may be reused by `requested`.
 *
 * Same-flow retries are allowed. A missing row or a claim owned by the
 * other flow must fail closed.
 */
export function evaluateBankReceiptAttachmentClaim(
  existingType: string | null | undefined,
  requested: BankReceiptAttachmentClaimType,
): BankReceiptAttachmentClaimVerdict {
  if (existingType == null || existingType === '') {
    return { ok: false, reason: 'missing' }
  }
  if (existingType === requested) {
    return { ok: true }
  }
  return { ok: false, reason: 'other_flow' }
}
