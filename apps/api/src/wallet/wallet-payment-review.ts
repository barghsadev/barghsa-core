import { ConflictException, NotFoundException } from '@nestjs/common';
import type { WalletPaymentReviewData } from '@barghsa/shared/finance';
import type { WalletQueryClient } from './wallet.service.js';
import { ReviewSnapshotService } from '../finance/review-snapshot.service.js';

interface InvoiceRow {
  id: string;
  state: string;
  order_id: string | null;
  contract_id: string | null;
  issued_at: Date | null;
  payable_from: Date | null;
  due_at: Date | null;
  total_amount: string;
  paid_amount: string;
  order_type: string | null;
  profile_type: string;
  profile_title: string;
}
interface LineRow {
  id: string;
  description: string;
  quantity: number;
  unit_price: string;
  line_total: string;
  vat_rate: number;
  vat_amount: string;
  is_taxable: boolean;
}
interface ContractRow {
  id: string;
  current_version_id: string;
  state: string;
  service_type: string;
  rule_revision: number;
  signature_required: boolean;
  payment_required: boolean;
  initial_invoice: boolean | null;
  service_start_required: boolean;
  service_starts_at: Date | null;
  service_ends_at: Date | null;
}

export const walletPaymentReviewScope = (invoiceId: string, profileId: string) => ({
  action: 'invoice.wallet-payment',
  profileId,
  resourceId: invoiceId,
});

/** Caller holds the profile lock, wallet lock and invoice lock through commit.
 * Exclusive profile locking freezes contract creation/revision while confirming.
 * Prices come from the issued invoice, never today's mutable product catalogue. */
export async function readWalletPaymentReview(
  client: WalletQueryClient,
  invoiceId: string,
  profileId: string,
  remaining: bigint,
  available: bigint
) {
  const row = (
    await client.query(
      `SELECT i.id,i.state,i.order_id,i.contract_id,i.issued_at,i.payable_from,i.due_at,
        i.total_amount,i.paid_amount,o.order_type,
        p.profile_type,COALESCE(NULLIF(p.title,''),NULLIF(concat_ws(' ',p.first_name,p.last_name),''),'') AS profile_title
       FROM invoices i JOIN profiles p ON p.id=i.profile_id
       LEFT JOIN orders o ON o.id=i.order_id AND o.profile_id=i.profile_id
       WHERE i.id=$1 AND i.profile_id=$2`,
      [invoiceId, profileId]
    )
  ).rows[0] as InvoiceRow | undefined;
  if (!row) throw new NotFoundException();
  const lineRows = (
    await client.query(
      `SELECT id,description,quantity,unit_price,line_total,vat_rate,vat_amount,is_taxable
       FROM invoice_lines WHERE invoice_id=$1 ORDER BY position,id FOR SHARE`,
      [invoiceId]
    )
  ).rows as LineRow[];
  const lines = lineRows.map((line): WalletPaymentReviewData['lines'][number] => {
    const gross = BigInt(line.quantity) * BigInt(line.unit_price);
    const subtotal = BigInt(line.line_total);
    if (gross < subtotal) throw new ConflictException('Invoice breakdown requires reconciliation');
    return {
      id: line.id,
      description: line.description,
      quantity: line.quantity,
      unitPrice: String(line.unit_price),
      discount: (gross - subtotal).toString(),
      subtotal: subtotal.toString(),
      vatRate: line.vat_rate,
      vatAmount: String(line.vat_amount),
      taxable: line.is_taxable,
    };
  });
  const sum = (key: 'subtotal' | 'discount' | 'vatAmount') =>
    lines.reduce((total, line) => total + BigInt(line[key]), 0n);
  if (lines.length && sum('subtotal') + sum('vatAmount') !== BigInt(row.total_amount))
    throw new ConflictException('Invoice breakdown requires reconciliation');
  const contractRows = (
    await client.query(
      `SELECT c.id,c.current_version_id,c.state,c.service_type,r.rule_revision,
        r.signature_required,r.payment_required,r.service_start_required,
        r.initial_invoice_id=$1 AS initial_invoice,r.service_starts_at,r.service_ends_at
       FROM contracts c JOIN contract_activation_requirements r ON r.version_id=c.current_version_id
       WHERE c.profile_id=$2 AND c.state NOT IN ('Draft','AwaitingStaffReview','ChangesRequested')
         AND (r.initial_invoice_id=$1 OR c.id::text=$3 OR ($4::uuid IS NOT NULL AND c.order_id=$4))
       ORDER BY c.id FOR SHARE OF c,r`,
      [invoiceId, profileId, row.contract_id ?? null, row.order_id]
    )
  ).rows as ContractRow[];
  const contracts = contractRows.map((contract): WalletPaymentReviewData['contracts'][number] => ({
    id: contract.id,
    versionId: contract.current_version_id,
    state: contract.state,
    serviceType: contract.service_type,
    ruleRevision: contract.rule_revision,
    signatureRequired: contract.signature_required,
    paymentRequired: contract.payment_required,
    initialInvoice: contract.initial_invoice === true,
    serviceStartRequired: contract.service_start_required,
    serviceStartsAt: iso(contract.service_starts_at),
    serviceEndsAt: iso(contract.service_ends_at),
    cancellationRefund: contract.service_type === 'electricity' ? 'full_wallet' : 'staff_decision',
  }));
  const data: WalletPaymentReviewData = {
    currency: 'IRR',
    profile: { id: profileId, title: row.profile_title, type: row.profile_type },
    invoice: {
      id: invoiceId,
      state: row.state,
      orderId: row.order_id,
      serviceType: row.order_type ?? null,
      issuedAt: iso(row.issued_at),
      payableFrom: iso(row.payable_from),
      dueAt: iso(row.due_at),
      totalAmount: String(row.total_amount),
      paidAmount: String(row.paid_amount),
      remainingAmount: remaining.toString(),
    },
    lines,
    totals: lines.length
      ? {
          subtotal: sum('subtotal').toString(),
          discount: sum('discount').toString(),
          vat: sum('vatAmount').toString(),
        }
      : null,
    payment: {
      source: 'wallet',
      availableBefore: available.toString(),
      availableAfter: (available - remaining).toString(),
    },
    contracts,
    cancellation: 'separate_review_required',
  };
  return new ReviewSnapshotService().create(walletPaymentReviewScope(invoiceId, profileId), data);
}

function iso(value: Date | string | null) {
  return value === null ? null : new Date(value).toISOString();
}
