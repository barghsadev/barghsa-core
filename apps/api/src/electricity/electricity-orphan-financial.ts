import { ConflictException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  DUAL_APPROVAL_THRESHOLD_CONFIG_KEY,
  readInvoiceBankReceiptDualApprovalThreshold,
} from '@barghsa/shared/finance';
import {
  invoiceRefundBalances,
  type CancellationInvoice,
} from '../contract/contract-cancellation-snapshot.js';

/** Reuses the contract terminal invoice accounting for a genuine contractless order. */
export async function readOrphanFinancialState(
  client: PoolClient,
  orderId: string,
  profileId: string
) {
  const rows = (
    await client.query<
      CancellationInvoice & {
        profileId: string;
        contractId: string | null;
        adjustmentKind: string | null;
        pendingPayments: boolean;
        source: string;
      }
    >(
      `SELECT i.id,i.state,i.total_amount::text AS "totalAmount",i.paid_amount::text AS "paidAmount",i.refunded_amount::text AS "refundedAmount",i.profile_id AS "profileId",i.contract_id AS "contractId",i.adjustment_kind AS "adjustmentKind",
      (EXISTS(SELECT 1 FROM bank_receipts b WHERE b.invoice_id=i.id AND b.state IN ('Submitted','UnderReview')) OR EXISTS(SELECT 1 FROM wallet_transactions w WHERE w.wallet_id=i.profile_id AND lower(w.ref_id)=i.id::text AND w.type='payment' AND w.state IN ('Pending','Reserved'))) AS "pendingPayments",
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'amount',r.amount::text,'state',r.state,'destination',r.destination) ORDER BY r.id) FROM refunds r WHERE r.invoice_id=i.id AND r.state NOT IN ('Completed','Rejected','Cancelled')),'[]'::jsonb) AS "pendingRefunds",
      to_jsonb(i)::text AS source FROM invoices i WHERE i.order_id=$1 ORDER BY i.id`,
      [orderId]
    )
  ).rows;
  if (
    rows.some(
      (i) =>
        i.profileId !== profileId ||
        i.contractId !== null ||
        i.adjustmentKind === 'credit' ||
        (BigInt(i.totalAmount) <= 0n &&
          !(
            i.totalAmount === '0' &&
            i.paidAmount === '0' &&
            i.refundedAmount === '0' &&
            ['Cancelled', 'Refunded'].includes(i.state)
          )) ||
        ![
          'Draft',
          'Unpaid',
          'Overdue',
          'Paid',
          'PartiallyFunded',
          'PartiallyRefunded',
          'Refunded',
          'Cancelled',
        ].includes(i.state) ||
        i.pendingPayments ||
        i.pendingRefunds.length ||
        (['Draft', 'Cancelled', 'Refunded'].includes(i.state) &&
          BigInt(i.paidAmount) > BigInt(i.refundedAmount))
    )
  )
    throw new ConflictException('Orphan invoice facts require reconciliation');
  const invoices = invoiceRefundBalances(rows),
    refundAmount = invoices.reduce((sum, i) => sum + BigInt(i.refundableAmount), 0n).toString();
  if (BigInt(refundAmount) > 9223372036854775807n)
    throw new ConflictException('Order refund impact exceeds int8');
  const raw = (
    await client.query('SELECT value FROM app_config WHERE key=$1', [
      DUAL_APPROVAL_THRESHOLD_CONFIG_KEY,
    ])
  ).rows[0]?.value;
  const parsed = readInvoiceBankReceiptDualApprovalThreshold(raw);
  if (parsed.status === 'corrupt')
    throw new ConflictException('Financial approval configuration is invalid');
  const policy =
    parsed.status === 'enabled'
      ? { enabled: true, thresholdIrR: String(parsed.thresholdIrR) }
      : { enabled: false };
  return {
    invoices,
    refundAmount,
    policy,
    approvalRequired: policy.enabled && BigInt(refundAmount) >= BigInt(policy.thresholdIrR!),
    paid: rows.some((i) => BigInt(i.paidAmount) > 0n),
    source: rows.map((i) => i.source).join(''),
  };
}
