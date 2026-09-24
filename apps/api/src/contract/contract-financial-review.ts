import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  parseContractFinancialReview,
  type ContractFinancialReviewData,
  type ContractFinancialReviewAction,
} from '@barghsa/shared/finance';
import { ReviewSnapshotService } from '../finance/review-snapshot.service.js';
import { readInvoiceFinancialDetails } from '../finance/invoice-review.js';
import type { WalletQueryClient } from '../wallet/wallet.service.js';

export type ContractFinancialReviewInput = {
  contractId: string;
  profileId: string;
  versionId: string;
} & (
  | { action: 'contract.acceptance' }
  | {
      action: 'contract.signature-request';
      originalDocumentId: string;
      expectedRequestId: string | null;
    }
  | { action: 'contract.signature-record'; signedDocumentId: string; requestId: string }
);

interface ContractRow {
  id: string;
  profile_id: string;
  profile_type: string;
  profile_title: string;
  service_type: 'electricity' | 'savings' | 'solar';
  state: ContractFinancialReviewData['contract']['state'];
  effective_state: 'Accepted' | 'Signed' | 'Active';
  amendment_base_version_id: string | null;
  version_id: string;
  version_number: number;
  content: ContractFinancialReviewData['contract']['content'];
  published_at: Date | string;
  rule_revision: number;
  signature_required: boolean;
  payment_required: boolean;
  service_start_required: boolean;
  service_starts_at: Date | string | null;
  service_ends_at: Date | string | null;
  initial_invoice_id: string | null;
}

export function contractFinancialReviewScope(
  action: ContractFinancialReviewAction,
  profileId: string,
  contractId: string
) {
  return { action, profileId, resourceId: contractId };
}

/** Caller holds the exclusive profile lock before actor/contract/invoice/document locks.
 * Only the current published version and its frozen activation requirements are reviewed.
 */
export async function readContractFinancialReview(
  client: WalletQueryClient,
  input: ContractFinancialReviewInput
) {
  const row = (
    await client.query(
      `SELECT c.id,c.profile_id,c.service_type,
       CASE WHEN amendment.state='AwaitingCustomerAcceptance' AND $4::boolean
         THEN 'AwaitingCustomerAcceptance'::contract_state ELSE c.state END AS state,
       c.state AS effective_state,
       CASE WHEN amendment.state='AwaitingCustomerAcceptance' AND $4::boolean
         THEN amendment.base_version_id ELSE NULL END AS amendment_base_version_id,
       p.profile_type,
       COALESCE(NULLIF(p.title,''),NULLIF(concat_ws(' ',p.first_name,p.last_name),''),'') AS profile_title,
       v.id AS version_id,v.version_number,v.content,pub.published_at,r.rule_revision,
       r.signature_required,r.payment_required,r.service_start_required,r.service_starts_at,r.service_ends_at,r.initial_invoice_id
     FROM contracts c JOIN profiles p ON p.id=c.profile_id
     JOIN contract_versions v ON v.contract_id=c.id AND v.id=$3
     JOIN contract_publications pub ON pub.version_id=v.id AND pub.contract_id=c.id
     JOIN contract_activation_requirements r ON r.version_id=v.id AND r.contract_id=c.id
     LEFT JOIN contract_amendments amendment ON amendment.version_id=v.id AND amendment.contract_id=c.id
     WHERE c.id=$1 AND c.profile_id=$2 AND
       (v.id=c.current_version_id OR ($4::boolean AND EXISTS(
         SELECT 1 FROM contract_amendments a WHERE a.contract_id=c.id AND a.version_id=v.id
           AND a.base_version_id=c.current_version_id AND a.state='AwaitingCustomerAcceptance'
       ))) FOR SHARE OF c,v,r`,
      [input.contractId, input.profileId, input.versionId, input.action === 'contract.acceptance']
    )
  ).rows[0] as ContractRow | undefined;
  if (!row) throw new NotFoundException();
  let initialInvoice: ContractFinancialReviewData['initialInvoice'] = null;
  if (row.initial_invoice_id) {
    const invoice = (
      await client.query(
        'SELECT total_amount,paid_amount FROM invoices WHERE id=$1 AND profile_id=$2 FOR SHARE',
        [row.initial_invoice_id, input.profileId]
      )
    ).rows[0] as { total_amount: string; paid_amount: string } | undefined;
    if (!invoice) throw new ConflictException('Initial invoice requires reconciliation');
    initialInvoice = await readInvoiceFinancialDetails(
      client,
      row.initial_invoice_id,
      input.profileId,
      BigInt(invoice.total_amount) - BigInt(invoice.paid_amount)
    );
  }
  let signature: ContractFinancialReviewData['signature'] = null;
  if (input.action !== 'contract.acceptance') {
    const request = (
      await client.query(
        'SELECT id,request_number,original_document_id FROM contract_signature_requests WHERE contract_id=$1 AND version_id=$2 ORDER BY request_number DESC LIMIT 1 FOR SHARE',
        [input.contractId, input.versionId]
      )
    ).rows[0] as { id: string; request_number: number; original_document_id: string } | undefined;
    const expectedRequestId =
      input.action === 'contract.signature-request' ? input.expectedRequestId : input.requestId;
    if ((request?.id ?? null) !== expectedRequestId)
      throw new ConflictException('The signing request changed');
    const originalDocumentId =
      input.action === 'contract.signature-request'
        ? input.originalDocumentId
        : request!.original_document_id;
    signature = {
      requestId: request?.id ?? null,
      requestNumber: request?.request_number ?? null,
      originalDocument: await reviewedDocument(client, input, originalDocumentId, 'original'),
      signedDocument:
        input.action === 'contract.signature-record'
          ? await reviewedDocument(client, input, input.signedDocumentId, 'signed')
          : null,
    };
  }
  const data: ContractFinancialReviewData = {
    currency: 'IRR',
    profile: { id: input.profileId, title: row.profile_title, type: row.profile_type },
    contract: {
      id: row.id,
      versionId: row.version_id,
      versionNumber: row.version_number,
      serviceType: row.service_type,
      state: row.state,
      ...(row.amendment_base_version_id
        ? {
            amendment: {
              baseVersionId: row.amendment_base_version_id,
              effectiveState: row.effective_state,
            },
          }
        : {}),
      publishedAt: iso(row.published_at)!,
      content: row.content,
    },
    activation: {
      ruleRevision: row.rule_revision,
      signatureRequired: row.signature_required,
      paymentRequired: row.payment_required,
      serviceStartRequired: row.service_start_required,
      serviceStartsAt: iso(row.service_starts_at),
      serviceEndsAt: iso(row.service_ends_at),
      initialInvoiceId: row.initial_invoice_id,
    },
    initialInvoice,
    payment: { source: 'none', amount: '0' },
    cancellationRefund: row.service_type === 'electricity' ? 'full_wallet' : 'staff_decision',
    signature,
  };
  const review = new ReviewSnapshotService().create(
    contractFinancialReviewScope(input.action, input.profileId, input.contractId),
    data
  );
  if (!parseContractFinancialReview(review))
    throw new ConflictException('Contract review requires reconciliation');
  return review;
}

async function reviewedDocument(
  client: WalletQueryClient,
  input: ContractFinancialReviewInput,
  documentId: string,
  role: 'original' | 'signed'
) {
  const row = (
    await client.query(
      `SELECT d.id,d.original_name,d.checksum,cd.contract_id,cd.contract_version_id
     FROM documents d JOIN contract_documents cd ON cd.document_id=d.id
     WHERE d.id=$1 AND d.profile_id=$2 AND cd.contract_id=$3 AND cd.contract_version_id=$4 AND cd.role=$5
       AND d.state='Approved' AND d.storage_key IS NOT NULL AND d.checksum IS NOT NULL
       AND ($5<>'original' OR d.detected_mime='application/pdf') FOR SHARE OF d,cd`,
      [documentId, input.profileId, input.contractId, input.versionId, role]
    )
  ).rows[0] as
    | {
        id: string;
        original_name: string;
        checksum: string;
        contract_id: string;
        contract_version_id: string;
      }
    | undefined;
  if (!row) throw new ConflictException('The reviewed signing document changed');
  return {
    id: row.id,
    originalName: row.original_name,
    checksum: row.checksum,
    contractId: row.contract_id,
    versionId: row.contract_version_id,
    state: 'Approved' as const,
  };
}

function iso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}
