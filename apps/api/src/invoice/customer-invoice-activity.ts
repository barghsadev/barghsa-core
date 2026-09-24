import type { Pool, PoolClient } from 'pg';

export interface CustomerInvoicePayment {
  id: string;
  source: 'wallet' | 'bank_receipt';
  amount: string;
  state: string;
  createdAt: string;
}
export interface CustomerInvoiceBankReceipt {
  id: string;
  amount: string;
  state: string;
  paymentDate: string;
  payerReference: string;
  bankName: string | null;
  customerNote: string | null;
  rejectionReason: string | null;
  confirmedAt: string | null;
  createdAt: string;
  statusHistory: Array<{
    state: 'Submitted' | 'UnderReview' | 'Confirmed' | 'Rejected';
    occurredAt: string;
    backfilled: boolean;
  }>;
}
export interface CustomerInvoiceRefund {
  id: string;
  amount: string;
  state: string;
  destination: 'wallet' | 'external_bank';
  createdAt: string;
  updatedAt: string;
}
export interface CustomerInvoiceActivity {
  payments: CustomerInvoicePayment[];
  bankReceipts: CustomerInvoiceBankReceipt[];
  refunds: CustomerInvoiceRefund[];
}

/** Read only the viewed invoice under its caller's existing authorization boundary.
 * Explicit projections keep staff IDs, storage keys and internal metadata private.
 * Money is cast to text in SQL, including the bank receipt's net invoice allocation.
 */
export async function loadCustomerInvoiceActivity(
  client: Pool | PoolClient,
  invoiceId: string,
  profileId: string
): Promise<CustomerInvoiceActivity> {
  const payments = await client.query<
    Omit<CustomerInvoicePayment, 'createdAt'> & { createdAt: Date }
  >(
    `SELECT id, source, amount, state, "createdAt" FROM (
       SELECT id, 'wallet' AS source, (-amount::numeric)::text AS amount, state,
              created_at AS "createdAt"
       FROM wallet_transactions
       WHERE ref_id=$1 AND wallet_id=$2::uuid AND type='payment' AND amount<0
       UNION ALL
       SELECT r.id, 'bank_receipt' AS source,
              (r.amount::numeric - COALESCE(c.amount,0))::text AS amount,
              r.state, r.confirmed_at AS "createdAt"
       FROM bank_receipts r
       LEFT JOIN wallet_transactions c ON c.wallet_id=r.profile_id
         AND c.idempotency_key='invoice-bank-receipt-overpayment-credit:' || r.id::text
       WHERE r.invoice_id=$1::uuid AND r.profile_id=$2::uuid AND r.state='Confirmed'
     ) payments ORDER BY "createdAt", id`,
    [invoiceId, profileId]
  );
  const bankReceipts = await client.query<
    Omit<CustomerInvoiceBankReceipt, 'createdAt' | 'confirmedAt' | 'statusHistory'> & {
      createdAt: Date;
      confirmedAt: Date | null;
    }
  >(
    `SELECT id, amount::text, state, payment_date::text AS "paymentDate",
            payer_reference AS "payerReference", bank_name AS "bankName",
            customer_note AS "customerNote",
            rejection_reason AS "rejectionReason", confirmed_at AS "confirmedAt",
            created_at AS "createdAt"
     FROM bank_receipts WHERE invoice_id=$1::uuid AND profile_id=$2::uuid
     ORDER BY created_at, id`,
    [invoiceId, profileId]
  );
  const receiptEvents = await client.query<{
    receiptId: string;
    state: CustomerInvoiceBankReceipt['statusHistory'][number]['state'];
    occurredAt: Date;
    backfilled: boolean;
  }>(
    `SELECT e.receipt_id AS "receiptId", e.state, e.occurred_at AS "occurredAt", e.backfilled
       FROM bank_receipt_status_events e
       JOIN bank_receipts r ON r.id=e.receipt_id
      WHERE r.invoice_id=$1::uuid AND r.profile_id=$2::uuid
      ORDER BY e.occurred_at, e.id`,
    [invoiceId, profileId]
  );
  const historyByReceipt = new Map<string, CustomerInvoiceBankReceipt['statusHistory']>();
  for (const event of receiptEvents.rows) {
    const history = historyByReceipt.get(event.receiptId) ?? [];
    history.push({
      state: event.state,
      occurredAt: event.occurredAt.toISOString(),
      backfilled: event.backfilled,
    });
    historyByReceipt.set(event.receiptId, history);
  }
  const refunds = await client.query<
    Omit<CustomerInvoiceRefund, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date }
  >(
    `SELECT id, amount::text, state, destination, created_at AS "createdAt", updated_at AS "updatedAt"
     FROM refunds WHERE invoice_id=$1::uuid AND profile_id=$2::uuid
     ORDER BY created_at, id`,
    [invoiceId, profileId]
  );
  return {
    payments: payments.rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    bankReceipts: bankReceipts.rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      statusHistory: historyByReceipt.get(row.id) ?? [],
    })),
    refunds: refunds.rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
  };
}
