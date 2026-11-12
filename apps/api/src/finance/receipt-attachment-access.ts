import {
  BANK_RECEIPT_STORAGE_PURPOSE,
  INVOICE_BANK_RECEIPT_SEALED_PREFIX,
} from '@barghsa/shared/finance';
import type { WalletQueryClient } from '../wallet/wallet.service.js';

export interface ReceiptAttachmentBinding {
  receiptId: string;
  profileId: string;
  flow: 'invoice' | 'wallet';
}

export interface ReceiptAttachmentEvidence {
  key: string | null;
  mime: string | null;
}

export async function loadReceiptAttachments(
  client: WalletQueryClient,
  flow: ReceiptAttachmentBinding['flow'],
  receiptIds: string[],
  scope: { profileId?: string; invoiceId?: string; customerWallet?: boolean } = {}
): Promise<Map<string, ReceiptAttachmentEvidence>> {
  if (!receiptIds.length) return new Map();
  const receipts =
    flow === 'invoice'
      ? `SELECT r.id, r.profile_id, r.attachment_key FROM bank_receipts r
         JOIN invoices i ON i.id=r.invoice_id AND i.profile_id=r.profile_id
         WHERE r.id=ANY($1::uuid[]) AND ($2::uuid IS NULL OR r.profile_id=$2)
           AND ($3::uuid IS NULL OR r.invoice_id=$3) AND NOT $4::boolean`
      : `SELECT t.id, t.wallet_id AS profile_id,
           COALESCE(t.receipt_attachment_key,t.metadata#>>'{receipt,attachmentKey}') AS attachment_key
         FROM wallet_transactions t
         WHERE t.id=ANY($1::uuid[]) AND ($2::uuid IS NULL OR t.wallet_id=$2)
           AND $3::uuid IS NULL AND (NOT $4::boolean OR t.state<>'Completed')
           AND t.type='topup' AND t.metadata->>'channel'='bank_receipt'
           AND NOT (t.metadata ? 'pendingTransactionId')`;
  // Historical copies may predate explicit bindings. Keep proven receipt
  // copies and claims readable, including owner-submitted older uploads.
  const { rows } = await client.query(
    `WITH receipts AS (${receipts})
     SELECT r.id, s.storage_key AS key, s.content_type AS mime
     FROM receipts r LEFT JOIN storage_records s ON s.storage_key=r.attachment_key
       AND s.status='immutable' AND CASE
         WHEN s.metadata ? 'receiptBinding' THEN
           s.metadata->'receiptBinding'=jsonb_build_object('receiptId',r.id,'profileId',r.profile_id,'flow',$5::text)
         ELSE COALESCE(s.metadata->>'purpose','${BANK_RECEIPT_STORAGE_PURPOSE}')='${BANK_RECEIPT_STORAGE_PURPOSE}'
           AND COALESCE(s.metadata->>'sealedAttachmentKey',s.storage_key)=s.storage_key
           AND (
             s.storage_key LIKE '${INVOICE_BANK_RECEIPT_SEALED_PREFIX}%'
             OR s.storage_key LIKE 'sealed-receipts/%'
             OR EXISTS(SELECT 1 FROM bank_receipt_attachment_claims claim WHERE claim.storage_key=s.storage_key
               AND claim.claim_type=CASE $5::text WHEN 'invoice' THEN 'invoice_receipt' ELSE 'wallet_topup' END)
           )
           AND NOT EXISTS(SELECT 1 FROM bank_receipt_attachment_claims claim
             WHERE claim.storage_key=COALESCE(s.metadata->>'sourceAttachmentKey',s.storage_key)
               AND claim.claim_type<>CASE $5::text WHEN 'invoice' THEN 'invoice_receipt' ELSE 'wallet_topup' END)
           AND (
             s.metadata->>'profileId' IS NULL OR s.metadata->>'profileId'=r.profile_id::text
             OR (s.metadata->>'uploadedBy'=s.signed_by AND EXISTS(
               SELECT 1 FROM audit_log a
               WHERE a.event=CASE $5::text WHEN 'invoice' THEN 'invoice_bank_receipt_submitted' ELSE 'wallet_bank_receipt_submitted' END
                 AND a.user_id=s.signed_by AND a.metadata::jsonb->>'receiptId'=r.id::text
                 AND a.metadata::jsonb->>'profileId'=r.profile_id::text))
           )
           AND NOT EXISTS(SELECT 1 FROM bank_receipts other
             WHERE other.attachment_key=s.storage_key AND other.profile_id<>r.profile_id)
           AND NOT EXISTS(SELECT 1 FROM wallet_transactions other
             WHERE other.receipt_attachment_key=s.storage_key AND other.wallet_id<>r.profile_id)
           AND (s.metadata->>'profileId' IS NOT NULL OR NOT EXISTS(
             SELECT 1 FROM wallet_transactions other
             WHERE other.receipt_attachment_key IS NULL AND other.type='topup'
               AND other.metadata->>'channel'='bank_receipt' AND NOT (other.metadata ? 'pendingTransactionId')
               AND other.metadata#>>'{receipt,attachmentKey}'=s.storage_key AND other.wallet_id<>r.profile_id))
         END`,
    [
      receiptIds,
      scope.profileId ?? null,
      scope.invoiceId ?? null,
      scope.customerWallet ?? false,
      flow,
    ]
  );
  return new Map(
    (rows as Array<ReceiptAttachmentEvidence & { id: string }>).map(({ id, key, mime }) => [
      id,
      { key, mime },
    ])
  );
}
