import type { Pool } from 'pg';
import { getDbPool } from '@barghsa/db';
import { INVOICE_BANK_RECEIPT_CHANNEL, parseLedgerAmount } from '@barghsa/shared/finance';

export const INVOICE_RECONCILIATION_JOB_TYPE = 'invoice_reconciliation_scan';
export const DEFAULT_INVOICE_RECONCILIATION_INTERVAL_MS = 60 * 60 * 1000;

function metadataAmountMismatch(key: 'walletCreditAmount' | 'invoiceAllocation', expected: string) {
  // Compare exact integer value without casting untrusted, possibly huge JSON strings.
  return `(c.metadata ? '${key}' AND (NOT COALESCE(c.metadata->>'${key}' ~ '^[0-9]+$',FALSE)
    OR COALESCE(NULLIF(ltrim(c.metadata->>'${key}','0'),''),'0') IS DISTINCT FROM ${expected}))`;
}

// Both selection and locked recheck use the same exact funding projection.
// A confirmed receipt's excess is a wallet credit, not a payment of its invoice.
function snapshotSql(target: string) {
  return `WITH target AS (
    SELECT id,profile_id,paid_amount FROM invoices ${target}
  ), receipts AS (
    SELECT b.invoice_id, SUM(b.amount::numeric) AS gross,
      COALESCE(SUM(CASE WHEN c.type='topup' AND c.state='Completed'
        AND c.wallet_id=b.profile_id AND lower(c.ref_id)=b.id::text AND c.amount>0
        THEN c.amount::numeric ELSE 0 END),0) AS excess,
      COUNT(c.id) FILTER (WHERE c.type<>'topup' OR c.state<>'Completed'
        OR c.wallet_id<>b.profile_id OR lower(c.ref_id) IS DISTINCT FROM b.id::text
        OR c.amount<=0 OR c.amount>b.amount
        OR (c.metadata ? 'channel' AND c.metadata->>'channel' IS DISTINCT FROM '${INVOICE_BANK_RECEIPT_CHANNEL}')
        OR (c.metadata ? 'purpose' AND c.metadata->>'purpose' IS DISTINCT FROM 'overpayment')
        OR (c.metadata ? 'receiptId' AND lower(c.metadata->>'receiptId') IS DISTINCT FROM b.id::text)
        OR (c.metadata ? 'invoiceId' AND lower(c.metadata->>'invoiceId') IS DISTINCT FROM b.invoice_id::text)
        OR ${metadataAmountMismatch('walletCreditAmount', 'c.amount::text')}
        OR ${metadataAmountMismatch('invoiceAllocation', '(b.amount::numeric-c.amount::numeric)::text')}
      ) AS invalid_credits
    FROM bank_receipts b JOIN target i ON i.id=b.invoice_id
    LEFT JOIN wallet_transactions c
      ON c.idempotency_key='invoice-bank-receipt-overpayment-credit:'||b.id::text
    WHERE b.state='Confirmed' GROUP BY b.invoice_id
  ), payments AS (
    SELECT i.id,
      COALESCE(SUM(CASE WHEN p.wallet_id=i.profile_id AND p.amount<0
        THEN -(p.amount::numeric) ELSE 0 END),0) AS paid,
      COUNT(p.id) FILTER (WHERE p.wallet_id<>i.profile_id OR p.amount>=0) AS invalid_payments
    FROM target i JOIN wallet_transactions p ON lower(p.ref_id)=i.id::text
    WHERE p.type='payment' AND p.state='Completed' GROUP BY i.id
  )
  SELECT i.id,i.profile_id,i.paid_amount::text,
    COALESCE(r.gross,0)::text AS receipt_gross,
    COALESCE(r.excess,0)::text AS receipt_excess,
    COALESCE(p.paid,0)::text AS wallet_paid,
    COALESCE(r.invalid_credits,0)::text AS invalid_receipt_credits,
    COALESCE(p.invalid_payments,0)::text AS invalid_wallet_payments
  FROM target i LEFT JOIN receipts r ON r.invoice_id=i.id
  LEFT JOIN payments p ON p.id=i.id`;
}

export const FIND_INVOICE_RECONCILIATION_CANDIDATES_SQL = `SELECT s.id FROM (${snapshotSql('')}) s
  WHERE (s.paid_amount::numeric<>s.receipt_gross::numeric-s.receipt_excess::numeric+s.wallet_paid::numeric
    OR s.invalid_receipt_credits::numeric>0 OR s.invalid_wallet_payments::numeric>0)
  AND NOT EXISTS (SELECT 1 FROM reconciliation_exceptions e
    WHERE e.exception_type='payment_mismatch' AND e.status IN ('open','investigating')
      AND e.details->>'source'='invoice_payments' AND e.details->>'invoiceId'=s.id::text)
  ORDER BY s.id LIMIT $1`;

interface Snapshot {
  id: string;
  profile_id: string;
  paid_amount: string;
  receipt_gross: string;
  receipt_excess: string;
  wallet_paid: string;
  invalid_receipt_credits: string;
  invalid_wallet_payments: string;
}

/** Report drift only. Invoice locks serialize with settlement/cancellation;
 * immutable financial rows and counters are never repaired by this worker. */
export async function reconcileInvoicePayments(options: { pool?: Pool; batchSize?: number } = {}) {
  const size = options.batchSize ?? 200;
  if (!Number.isSafeInteger(size) || size < 1 || size > 1000)
    throw new RangeError('Invoice reconciliation batch size must be between 1 and 1000');
  const pool = options.pool ?? getDbPool();
  const candidates = await pool.query<{ id: string }>(FIND_INVOICE_RECONCILIATION_CANDIDATES_SQL, [
    size,
  ]);
  const result = {
    scanned: candidates.rows.length,
    reported: 0,
    skipped: 0,
    truncated: candidates.rows.length === size,
    errors: [] as string[],
  };
  for (const candidate of candidates.rows) {
    let client: import('pg').PoolClient | undefined;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      if (
        !(
          await client.query('SELECT id FROM invoices WHERE id=$1 FOR UPDATE SKIP LOCKED', [
            candidate.id,
          ])
        ).rows.length
      ) {
        result.skipped++;
        await client.query('ROLLBACK');
        continue;
      }
      const snapshot = (await client.query<Snapshot>(snapshotSql('WHERE id=$1'), [candidate.id]))
        .rows[0];
      if (!snapshot) throw new Error('Locked invoice disappeared');
      const paid = parseLedgerAmount(snapshot.paid_amount);
      const gross = parseLedgerAmount(snapshot.receipt_gross);
      const excess = parseLedgerAmount(snapshot.receipt_excess);
      const wallet = parseLedgerAmount(snapshot.wallet_paid);
      const badReceipts = parseLedgerAmount(snapshot.invalid_receipt_credits);
      const badPayments = parseLedgerAmount(snapshot.invalid_wallet_payments);
      const delta = paid - (gross - excess + wallet);
      const existing = (
        await client.query(
          `SELECT id FROM reconciliation_exceptions
        WHERE exception_type='payment_mismatch' AND status IN ('open','investigating')
          AND details->>'source'='invoice_payments' AND details->>'invoiceId'=$1 LIMIT 1`,
          [candidate.id]
        )
      ).rows.length;
      if ((delta === 0n && badReceipts === 0n && badPayments === 0n) || existing) {
        result.skipped++;
        await client.query('ROLLBACK');
        continue;
      }
      await client.query(
        `INSERT INTO reconciliation_exceptions(exception_type,severity,status,description,details)
        VALUES('payment_mismatch','high','open',$1,$2::jsonb)`,
        [
          `Invoice funding mismatch: ${snapshot.id}`,
          JSON.stringify({
            source: 'invoice_payments',
            invoiceId: snapshot.id,
            walletId: snapshot.profile_id,
            paidAmount: paid.toString(),
            receiptGross: gross.toString(),
            receiptExcess: excess.toString(),
            receiptApplied: (gross - excess).toString(),
            walletPayments: wallet.toString(),
            recordedFunding: (gross - excess + wallet).toString(),
            delta: delta.toString(),
            invalidReceiptCredits: badReceipts.toString(),
            invalidWalletPayments: badPayments.toString(),
          }),
        ]
      );
      await client.query('COMMIT');
      result.reported++;
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => {});
      result.errors.push(
        `${candidate.id}: ${error instanceof Error ? error.message : 'Invoice reconciliation failed'}`
      );
    } finally {
      client?.release();
    }
  }
  return result;
}
