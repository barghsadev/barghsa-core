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
      cancelled_at: Date | null;
      recorded: boolean;
      pending_payments: boolean;
      saving_terminal: boolean;
      unbound_refunds: boolean;
      refunds: RefundStatus[];
    }>(
      `SELECT c.id,c.state,c.cancelled_at,
  EXISTS(SELECT 1 FROM contract_cancellations x WHERE x.contract_id=c.id) AS recorded,
  contract_has_pending_payments(c.id) AS pending_payments,
  EXISTS(SELECT 1 FROM saving_orders s WHERE s.order_id=c.order_id
    AND s.status IN ('completed','rejected','cancelled')) AS saving_terminal,
   EXISTS(SELECT 1 FROM invoices i JOIN refunds r ON r.invoice_id=i.id
     WHERE i.profile_id=c.profile_id AND (i.contract_id=c.id::text OR (c.order_id IS NOT NULL AND i.order_id=c.order_id AND i.contract_id IS NULL))
       AND r.state NOT IN ('Completed','Rejected','Cancelled')
       AND NOT EXISTS(SELECT 1 FROM contract_refund_obligations o WHERE o.refund_id=r.id AND o.contract_id=c.id)) AS unbound_refunds,
   COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'invoiceId',r.invoice_id,'amount',r.amount::text,
       'destination',r.destination,'state',r.state,'transactionState',t.state) ORDER BY r.id)
     FROM contract_refund_obligations o JOIN refunds r ON r.id=o.refund_id
     LEFT JOIN refund_transactions t ON t.refund_id=r.id WHERE o.contract_id=c.id),'[]'::jsonb) AS refunds
  FROM contracts c WHERE c.id=$1 AND ($2::uuid IS NULL OR (c.profile_id=$2 AND (
    EXISTS(SELECT 1 FROM contract_publications p WHERE p.contract_id=c.id)
    OR (c.service_type='savings'
      AND EXISTS(SELECT 1 FROM saving_orders s WHERE s.order_id=c.order_id)))))`,
      [id, profileId ?? null]
    )
  ).rows[0];
  if (!row) throw new NotFoundException();
  const failed = row.refunds.some((r) => ['Failed', 'Rejected', 'Cancelled'].includes(r.state));
  const completed = row.refunds.every(
    (r) => r.state === 'Completed' && r.transactionState === 'Completed'
  );
  const financialStatus =
    row.state !== 'Cancelled'
      ? 'not_cancelled'
      : !row.recorded
        ? 'unverified'
        : failed || row.pending_payments || row.unbound_refunds
          ? 'needs_attention'
          : completed
            ? 'closed'
            : 'refunds_pending';
  return {
    contractId: row.id,
    state: row.state,
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
