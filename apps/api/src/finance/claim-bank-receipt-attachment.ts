import { createHash } from 'node:crypto'
import { ConflictException } from '@nestjs/common'
import {
  BANK_RECEIPT_ATTACHMENT_LOCK_NAMESPACE,
  evaluateBankReceiptAttachmentClaim,
  type BankReceiptAttachmentClaimType,
} from '@barghsa/shared/finance'

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

interface QueryClient {
  query: (
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: unknown[]; rowCount?: number | null }>
}

/**
 * Transactionally claim a storage key for wallet top-up or invoice
 * receipt submission (T-04.3.01.02).
 *
 * Inserts when the key is free. Same-flow retries see the existing
 * claim and continue. A claim owned by the other flow is a conflict.
 * Callers must already hold the shared attachment advisory lock.
 */
export async function claimBankReceiptAttachment(
  client: QueryClient,
  storageKey: string,
  claimType: BankReceiptAttachmentClaimType,
): Promise<void> {
  await client.query(
    `INSERT INTO bank_receipt_attachment_claims (storage_key, claim_type)
     VALUES ($1, $2)
     ON CONFLICT (storage_key) DO NOTHING`,
    [storageKey, claimType],
  )
  const existing = await client.query(
    `SELECT claim_type
       FROM bank_receipt_attachment_claims
      WHERE storage_key = $1
      FOR UPDATE`,
    [storageKey],
  )
  const row = existing.rows[0] as { claim_type: string } | undefined
  const verdict = evaluateBankReceiptAttachmentClaim(row?.claim_type, claimType)
  if (!verdict.ok) {
    throw new ConflictException('This bank receipt attachment has already been submitted')
  }
}
