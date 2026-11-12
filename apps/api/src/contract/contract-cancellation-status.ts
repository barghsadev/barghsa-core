import { NotFoundException } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
export interface RefundStatus {
  id: string;
  invoiceId: string;
  amount: string;
  destination: 'wallet' | 'external_bank';
  state: string;
  transactionState: string | null;
}
/** One statement reports service and financial outcomes from a consistent snapshot. */
export async function readCancellationStatus(
  client: Pool | PoolClient,
  id: string,
  profileId?: string
) {
  const row = (
    await client.query<{
      id: string;
      state: string;
      service_type: string;
      rejection_available: boolean;
      cancelled_at: Date | null;
      recorded: boolean;
      pending_payments: boolean;
      saving_terminal: boolean;
      unbound_refunds: boolean;
      refund_conflict: boolean;
      refunds: RefundStatus[];
    }>(
      `SELECT c.id,c.state,c.cancelled_at,c.service_type,
  (c.service_type='electricity' AND c.current_version_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM electricity_orders e JOIN orders root ON root.id=e.id JOIN profiles owner ON owner.id=e.profile_id
    WHERE e.id=c.order_id AND e.profile_id=c.profile_id AND root.profile_id=c.profile_id AND root.order_type='electricity' AND root.status<>'CANCELLED' AND NOT owner.archived
      AND NOT EXISTS(SELECT 1 FROM electricity_contracts link WHERE link.order_id=e.id AND link.contract_id<>c.id)
      AND ((e.status='draft' AND c.state='Draft') OR (e.status IN ('submitted','awaiting_staff_review') AND c.state='AwaitingStaffReview') OR (e.status='changes_requested' AND c.state='ChangesRequested') OR (e.status='approved' AND c.state IN ('AwaitingCustomerAcceptance','Accepted','AwaitingSignature','Signed'))))) AS rejection_available,
  x.contract_id IS NOT NULL AS recorded,
  contract_has_pending_payments(c.id) AS pending_payments,
  EXISTS(SELECT 1 FROM saving_orders s WHERE c.service_type='savings'
    AND s.order_id=c.order_id AND s.profile_id=c.profile_id
    AND s.status IN ('completed','rejected','cancelled')) AS saving_terminal,
   EXISTS(SELECT 1 FROM invoices i JOIN refunds r ON r.invoice_id=i.id
     WHERE i.profile_id=c.profile_id AND (i.contract_id=c.id::text OR (c.order_id IS NOT NULL AND i.order_id=c.order_id AND i.contract_id IS NULL))
       AND r.profile_id=c.profile_id AND r.state NOT IN ('Completed','Rejected','Cancelled')
       AND NOT EXISTS(SELECT 1 FROM contract_refund_obligations o WHERE o.refund_id=r.id AND o.contract_id=c.id)) AS unbound_refunds,
   (obligations.has_conflict OR obligations.scoped_count<>COALESCE(jsonb_array_length(n.refund_decision->'refunds'),0)
     OR (x.contract_id IS NOT NULL AND n.financial_snapshot->>'profileId' IS DISTINCT FROM c.profile_id::text)) AS refund_conflict,
   obligations.scoped AS refunds
  FROM contracts c
  LEFT JOIN contract_cancellations x ON x.contract_id=c.id
  LEFT JOIN contract_cancellation_intents n ON n.id=x.intent_id AND n.contract_id=x.contract_id
  CROSS JOIN LATERAL (
    SELECT COALESCE(jsonb_agg(refund_facts ORDER BY refund_id)
      FILTER (WHERE in_scope), '[]'::jsonb) AS scoped,
      count(*) FILTER (WHERE in_scope) AS scoped_count,
      COALESCE(bool_or(in_scope IS NOT TRUE),false) AS has_conflict
    FROM (
      SELECT r.id AS refund_id, jsonb_build_object('id',r.id,'invoiceId',r.invoice_id,
        'amount',r.amount::text,'destination',r.destination,'state',r.state,'transactionState',t.state) AS refund_facts,
        (r.profile_id=c.profile_id AND i.profile_id=c.profile_id AND r.invoice_id=i.id
          AND n.financial_snapshot->>'profileId'=c.profile_id::text
          AND (i.contract_id=c.id::text OR (i.order_id=c.order_id AND i.contract_id IS NULL))
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(n.refund_decision->'refunds') line
            WHERE line->>'invoiceId'=i.id::text AND line->>'amount'=r.amount::text
              AND line->>'destination'=r.destination::text)) AS in_scope
      FROM contract_refund_obligations o
      LEFT JOIN invoices i ON i.id=o.invoice_id
      LEFT JOIN refunds r ON r.id=o.refund_id
      LEFT JOIN refund_transactions t ON t.refund_id=r.id
      WHERE o.contract_id=c.id
    ) refund_links
  ) obligations
  WHERE c.id=$1 AND ($2::uuid IS NULL OR (c.profile_id=$2 AND (
    EXISTS(SELECT 1 FROM contract_publications p WHERE p.contract_id=c.id)
    OR (c.service_type='electricity' AND c.state='Rejected' AND n.financial_snapshot->>'terminalAction'='reject'
      AND EXISTS(SELECT 1 FROM electricity_orders e JOIN orders root ON root.id=e.id
        WHERE e.id=c.order_id AND e.profile_id=c.profile_id AND root.profile_id=c.profile_id
          AND root.order_type='electricity' AND e.status='rejected' AND root.status='CANCELLED'))
    OR (c.service_type='savings'
      AND EXISTS(SELECT 1 FROM saving_orders s WHERE s.order_id=c.order_id AND s.profile_id=c.profile_id)))))`,
      [id, profileId ?? null]
    )
  ).rows[0];
  if (!row) throw new NotFoundException();
  const failed = row.refunds.some((r) => ['Failed', 'Rejected', 'Cancelled'].includes(r.state));
  const completed = row.refunds.every(
    (r) => r.state === 'Completed' && r.transactionState === 'Completed'
  );
  const financialStatus =
    row.state !== 'Cancelled' && !(row.state === 'Rejected' && row.recorded)
      ? 'not_cancelled'
      : !row.recorded
        ? 'unverified'
        : failed || row.pending_payments || row.unbound_refunds || row.refund_conflict
          ? 'needs_attention'
          : completed
            ? 'closed'
            : 'refunds_pending';
  return {
    contractId: row.id,
    state: row.state,
    serviceType: row.service_type,
    rejectionAvailable: row.rejection_available,
    savingTerminal: row.saving_terminal,
    cancelledAt: row.cancelled_at?.toISOString() ?? null,
    financialStatus,
    financiallyClosed: financialStatus === 'closed',
    refunds: row.refunds,
    refundAmount: row.refunds.reduce((sum, r) => sum + BigInt(r.amount), 0n).toString(),
    returnedAmount: row.refunds
      .filter((r) => r.state === 'Completed' && r.transactionState === 'Completed')
      .reduce((sum, r) => sum + BigInt(r.amount), 0n)
      .toString(),
  };
}
