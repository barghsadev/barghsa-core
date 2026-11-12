import { createHash } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';

export const cancellationHardwareCreditScope = `
  credit.adjustment_kind='credit' AND credit.accounting_amount=a.price_delta_irr
  AND saving_hardware_invoice_has_scope(
    a.order_id,a.contract_id,a.contract_version_id,a.original_invoice_id,credit
  )`;

export interface CancellationInvoice {
  id: string;
  state: string;
  totalAmount: string;
  paidAmount: string;
  refundedAmount: string;
  pendingRefunds: Array<{ id: string; amount: string; state: string; destination: string }>;
}
export interface CancellationSnapshotRow {
  id: string;
  profile_id: string;
  current_version_id: string;
  service_type: 'electricity' | 'savings' | 'solar';
  state: string;
  archived: boolean;
  association_conflict: boolean;
  ambiguous_order_invoices: boolean;
  pending_payments: boolean;
  saving_terminal?: boolean;
  rejection_order?: {
    orderId: string;
    profileId: string;
    rootProfileId: string;
    rootType: string;
    rootStatus: string;
    commercialStatus: string;
    linkConflict: boolean;
    stateFingerprint: string;
  } | null;
  invoices: CancellationInvoice[];
  hardware_credits?: Array<{
    id: string;
    state: string;
    totalAmount: string;
    paidAmount: string;
  }>;
}

/** A single statement gives the preview one consistent database snapshot. The
 * eventual command must lock its inputs and compare the same fingerprint. */
export async function readCancellationSnapshot(
  client: Pool | PoolClient,
  id: string,
  terminalAction: 'cancel' | 'reject' = 'cancel'
) {
  const row = (
    await client.query<CancellationSnapshotRow>(
      `
    SELECT c.id,c.profile_id,c.current_version_id,c.service_type,c.state,p.archived,
      CASE WHEN $2::boolean THEN electricity_rejection_order_snapshot(c.id) ELSE NULL END AS rejection_order,
      contract_has_pending_payments(c.id) AS pending_payments,
      EXISTS(SELECT 1 FROM saving_orders s WHERE c.service_type='savings'
        AND s.order_id=c.order_id AND s.profile_id=c.profile_id
        AND s.status IN ('completed','rejected','cancelled')) AS saving_terminal,
      (credits.has_conflict OR EXISTS(SELECT 1 FROM invoices i
        WHERE i.contract_id=c.id::text AND i.profile_id<>c.profile_id)) AS association_conflict,
      (c.order_id IS NOT NULL
        AND EXISTS(SELECT 1 FROM contracts other WHERE other.order_id=c.order_id AND other.id<>c.id AND other.state NOT IN ('Completed','Cancelled','Rejected'))
        AND EXISTS(SELECT 1 FROM invoices i WHERE i.order_id=c.order_id AND i.profile_id=c.profile_id AND i.contract_id IS NULL
          AND (i.paid_amount>i.refunded_amount OR i.state NOT IN ('Cancelled','Refunded')))) AS ambiguous_order_invoices,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id',i.id,'state',i.state,'totalAmount',i.total_amount::text,
        'paidAmount',i.paid_amount::text,'refundedAmount',i.refunded_amount::text,
        'pendingRefunds',COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id',r.id,'amount',r.amount::text,'state',r.state,'destination',r.destination) ORDER BY r.id)
          FROM refunds r WHERE r.invoice_id=i.id AND r.profile_id=c.profile_id
            AND r.state NOT IN ('Completed','Rejected','Cancelled')),'[]'::jsonb)
      ) ORDER BY i.id) FROM invoices i WHERE i.profile_id=c.profile_id
        AND i.adjustment_kind IS DISTINCT FROM 'credit'
        AND (i.contract_id=c.id::text OR (c.order_id IS NOT NULL AND i.order_id=c.order_id AND i.contract_id IS NULL))), '[]'::jsonb) AS invoices,
      credits.scoped AS hardware_credits
    FROM contracts c JOIN profiles p ON p.id=c.profile_id
    CROSS JOIN LATERAL (
      SELECT COALESCE(jsonb_agg(credit_facts ORDER BY credit_id)
        FILTER (WHERE in_scope), '[]'::jsonb) AS scoped,
        COALESCE(bool_or(in_scope IS NOT TRUE), false) AS has_conflict
      FROM (
        SELECT credit.id AS credit_id, jsonb_build_object(
          'id',credit.id,'state',credit.state,'totalAmount',credit.total_amount::text,
          'paidAmount',credit.paid_amount::text) AS credit_facts,
          (${cancellationHardwareCreditScope}) AS in_scope
        FROM saving_hardware_amendments a LEFT JOIN invoices credit ON credit.id=a.adjustment_invoice_id
        WHERE a.contract_id=c.id AND a.price_delta_irr<0
      ) hardware_credits
    ) credits
    WHERE c.id=$1`,
      [id, terminalAction === 'reject']
    )
  ).rows[0];
  if (!row) throw new NotFoundException();
  return cancellationSnapshot(row, terminalAction);
}

export function invoiceRefundBalances(input: CancellationInvoice[]) {
  return [...input]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((invoice) => {
      const pendingRefunds = [...invoice.pendingRefunds].sort((a, b) => a.id.localeCompare(b.id));
      const pending = pendingRefunds.reduce((sum, refund) => sum + BigInt(refund.amount), 0n);
      const paid = BigInt(invoice.paidAmount),
        returned = BigInt(invoice.refundedAmount);
      if (paid < 0n || returned < 0n || pending < 0n || returned + pending > paid)
        throw new ConflictException('Contract refund accounting requires reconciliation');
      return {
        id: invoice.id,
        state: invoice.state,
        totalAmount: invoice.totalAmount,
        paidAmount: paid.toString(),
        refundedAmount: returned.toString(),
        pendingRefunds,
        refundableAmount: (paid - returned).toString(),
        availableRefundAmount: (paid - returned - pending).toString(),
      };
    });
}

export function cancellationSnapshot(
  row: CancellationSnapshotRow,
  terminalAction: 'cancel' | 'reject' = 'cancel'
) {
  const hardwareCredits = [...(row.hardware_credits ?? [])].sort((a, b) =>
    a.id.localeCompare(b.id)
  );
  const invoices = invoiceRefundBalances(row.invoices);
  const total = (
    key: 'paidAmount' | 'refundedAmount' | 'refundableAmount' | 'availableRefundAmount'
  ) => invoices.reduce((sum, invoice) => sum + BigInt(invoice[key]), 0n).toString();
  const facts = {
    ...(terminalAction === 'reject'
      ? { terminalAction: 'reject' as const, electricityOrder: row.rejection_order ?? null }
      : {}),
    contractId: row.id,
    profileId: row.profile_id,
    versionId: row.current_version_id,
    serviceType: row.service_type,
    state: row.state,
    archived: row.archived,
    associationConflict: row.association_conflict,
    ambiguousOrderInvoices: row.ambiguous_order_invoices,
    pendingPayments: row.pending_payments,
    savingTerminal: row.saving_terminal ?? false,
    invoices,
    hardwareCredits,
  };
  const allowed: Record<string, readonly string[]> = {
    draft: ['Draft'],
    submitted: ['AwaitingStaffReview'],
    awaiting_staff_review: ['AwaitingStaffReview'],
    changes_requested: ['ChangesRequested'],
    approved: ['AwaitingCustomerAcceptance', 'Accepted', 'AwaitingSignature', 'Signed'],
  };
  const e = row.rejection_order;
  const rejectionAvailable =
    row.service_type === 'electricity' &&
    !!e &&
    e.profileId === row.profile_id &&
    e.rootProfileId === row.profile_id &&
    e.rootType === 'electricity' &&
    e.rootStatus !== 'CANCELLED' &&
    !e.linkConflict &&
    allowed[e.commercialStatus]?.includes(row.state) === true;
  const blockers = [
    ...(terminalAction === 'reject' && !rejectionAvailable
      ? ['electricity_rejection_unavailable']
      : []),
    ...(row.association_conflict ? ['invoice_identity_conflict'] : []),
    ...(row.ambiguous_order_invoices ? ['ambiguous_order_invoices'] : []),
    ...(row.archived ? ['profile_archived'] : []),
    ...(row.pending_payments ? ['payment_in_progress'] : []),
    ...(row.saving_terminal ? ['saving_order_terminal'] : []),
    ...(['Completed', 'Cancelled', 'Rejected'].includes(row.state) ? ['terminal_contract'] : []),
    ...(invoices.some((invoice) => invoice.pendingRefunds.length) ? ['refund_in_progress'] : []),
    ...(invoices.some((invoice) => invoice.state === 'PaymentUnderReview')
      ? ['payment_under_review']
      : []),
    ...(hardwareCredits.some(
      (credit) => credit.paidAmount !== '0' || !['Unpaid', 'Cancelled'].includes(credit.state)
    )
      ? ['hardware_credit_requires_reconciliation']
      : []),
  ];
  return {
    ...facts,
    fingerprint: createHash('sha256').update(JSON.stringify(facts)).digest('hex'),
    paidAmount: total('paidAmount'),
    refundedAmount: total('refundedAmount'),
    refundableAmount: total('refundableAmount'),
    availableRefundAmount: total('availableRefundAmount'),
    mandatoryWalletReturn:
      row.service_type === 'electricity' && BigInt(total('refundableAmount')) > 0n,
    blockers,
  };
}
