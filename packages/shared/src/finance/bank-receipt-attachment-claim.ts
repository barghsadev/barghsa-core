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

import { createHash } from 'node:crypto'

/** Claim owners stored on `bank_receipt_attachment_claims.claim_type`. */
export const BANK_RECEIPT_ATTACHMENT_CLAIM_TYPES = [
  'wallet_topup',
  'invoice_receipt',
] as const

export type BankReceiptAttachmentClaimType =
  (typeof BANK_RECEIPT_ATTACHMENT_CLAIM_TYPES)[number]

/**
 * Advisory-lock namespace shared by wallet top-up and invoice receipt
 * submission. Both flows must hash this prefix plus the storage key so
 * concurrent cross-flow claims serialize on one lock.
 */
export const BANK_RECEIPT_ATTACHMENT_LOCK_NAMESPACE = 'bank-receipt-attachment'

export type BankReceiptAttachmentClaimVerdict =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'other_flow' }

/**
 * Session-scoped `pg_advisory_lock` pair for one attachment key.
 * Wallet top-up and invoice upload must pass these exact integers.
 */
export function bankReceiptAttachmentAdvisoryLockKeys(
  attachmentKey: string,
): [number, number] {
  const digest = createHash('sha256')
    .update(`${BANK_RECEIPT_ATTACHMENT_LOCK_NAMESPACE}:${attachmentKey}`)
    .digest()
  return [digest.readInt32BE(0), digest.readInt32BE(4)]
}

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
