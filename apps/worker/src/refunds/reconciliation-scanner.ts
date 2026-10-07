import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { getDbPool } from '@barghsa/db';
import { parseLedgerAmount } from '@barghsa/shared/finance';

export const REFUND_RECONCILIATION_JOB_TYPE = 'refund_reconciliation_scan';
export const DEFAULT_REFUND_RECONCILIATION_INTERVAL_MS = 60 * 60 * 1000;

function snapshotSql(target: string) {
  return `WITH target AS (
    SELECT id,profile_id,adjustment_kind,paid_amount,refunded_amount FROM invoices ${target}
  ), rows AS (
    SELECT r.invoice_id,r.id,r.state,r.amount,t.id AS intent_id,
      (
        r.profile_id IS DISTINCT FROM i.profile_id
        OR (r.state IN ('Approved','Processing','Failed') AND
          (t.id IS NULL OR t.state IS DISTINCT FROM 'Pending' OR t.wallet_transaction_id IS NOT NULL OR t.finished_at IS NOT NULL))
        OR (r.state='Requested' AND t.id IS NOT NULL)
        OR (r.state IN ('Rejected','Cancelled') AND t.id IS NOT NULL AND
          (t.state::text IS DISTINCT FROM r.state::text OR t.wallet_transaction_id IS NOT NULL OR t.finished_at IS NULL))
        OR (r.state='Completed' AND t.id IS NOT NULL AND
          (t.state IS DISTINCT FROM 'Completed' OR t.finished_at IS NULL
            OR (r.destination='wallet' AND (c.id IS NULL OR t.wallet_transaction_id IS DISTINCT FROM c.id))
            OR (r.destination='external_bank' AND t.wallet_transaction_id IS NOT NULL)))
        OR (r.state='Completed' AND r.destination='external_bank' AND
          (NULLIF(btrim(r.bank_reference),'') IS NULL OR r.reconciliation_status IS DISTINCT FROM 'Confirmed'))
        OR (c.id IS NOT NULL AND
          (r.state<>'Completed' OR r.destination<>'wallet' OR c.wallet_id<>r.profile_id
            OR c.type<>'refund' OR c.state<>'Completed' OR c.amount<>r.amount
            OR lower(c.ref_id) IS DISTINCT FROM r.id::text
            OR (c.metadata ? 'refundId' AND lower(c.metadata->>'refundId') IS DISTINCT FROM r.id::text)
            OR (c.metadata ? 'invoiceId' AND lower(c.metadata->>'invoiceId') IS DISTINCT FROM r.invoice_id::text)))
      ) AS invalid
    FROM refunds r JOIN target i ON i.id=r.invoice_id
    LEFT JOIN refund_transactions t ON t.refund_id=r.id
    LEFT JOIN wallet_transactions c ON c.idempotency_key='refund-wallet-credit:'||r.id::text
  ), totals AS (
    SELECT invoice_id,
      COALESCE(SUM(amount::numeric) FILTER(WHERE state='Completed'),0) AS completed,
      COALESCE(SUM(amount::numeric) FILTER(WHERE state IN ('Requested','Approved','Processing','Failed')),0) AS reserved,
      COUNT(*) FILTER(WHERE invalid) AS invalid_count,
      (array_agg(id ORDER BY id) FILTER(WHERE invalid))[1:20] AS invalid_ids,
      COUNT(*) FILTER(WHERE state='Completed' AND intent_id IS NULL) AS legacy_completed_count
    FROM rows GROUP BY invoice_id
  ) SELECT i.id,i.profile_id,i.adjustment_kind,i.paid_amount::text,i.refunded_amount::text,
      COALESCE(t.completed,0)::text AS completed,COALESCE(t.reserved,0)::text AS reserved,
      COALESCE(t.invalid_count,0)::text AS invalid_count,COALESCE(t.invalid_ids,'{}'::uuid[]) AS invalid_ids,
      COALESCE(t.legacy_completed_count,0)::text AS legacy_completed_count
    FROM target i LEFT JOIN totals t ON t.invoice_id=i.id`;
}

const activeInvoice = `NOT EXISTS (SELECT 1 FROM reconciliation_exceptions e
  WHERE e.exception_type='payment_mismatch' AND e.status IN ('open','investigating')
    AND e.details->>'source'='refund_accounting' AND e.details->>'invoiceId'=s.id::text)`;
export const FIND_REFUND_RECONCILIATION_CANDIDATES_SQL = `SELECT s.id FROM (${snapshotSql('')}) s
  WHERE (s.completed::numeric>s.refunded_amount::numeric OR s.invalid_count::numeric>0
    OR (s.adjustment_kind IS DISTINCT FROM 'credit' AND s.reserved::numeric+s.refunded_amount::numeric>s.paid_amount::numeric))
    AND ${activeInvoice} ORDER BY s.id LIMIT $1`;

// Other legitimate wallet refunds (for example credit-note entitlements) use
// their own keys. Only the regular refund engine's key namespace is inspected.
const orphanSql = `SELECT c.id,c.wallet_id,c.amount::text,c.idempotency_key FROM wallet_transactions c
  WHERE c.type='refund' AND c.state='Completed' AND c.idempotency_key LIKE 'refund-wallet-credit:%'
    AND NOT EXISTS (SELECT 1 FROM refunds r WHERE c.idempotency_key='refund-wallet-credit:'||r.id::text)
    AND NOT EXISTS (SELECT 1 FROM reconciliation_exceptions e
      WHERE e.exception_type='payment_mismatch' AND e.status IN ('open','investigating')
        AND e.details->>'source'='refund_credit' AND e.details->>'transactionId'=c.id::text)`;

interface Snapshot {
  id: string;
  profile_id: string;
  adjustment_kind: string | null;
  paid_amount: string;
  refunded_amount: string;
  completed: string;
  reserved: string;
  invalid_count: string;
  invalid_ids: string[];
  legacy_completed_count: string;
}
interface Orphan {
  id: string;
  wallet_id: string;
  amount: string;
  idempotency_key: string;
}

/** Report existing engine/provenance invariants without repairing money.
 * Legacy counter residuals and pre-intent completed rows are retained. The
 * disputed specification inequality is deliberately not certified here. */
export async function reconcileRefunds(options: { pool?: Pool; batchSize?: number } = {}) {
  const size = options.batchSize ?? 200;
  if (!Number.isSafeInteger(size) || size < 1 || size > 1000)
    throw new RangeError('Refund reconciliation batch size must be between 1 and 1000');
  const pool = options.pool ?? getDbPool();
  const invoices = (
    await pool.query<{ id: string }>(FIND_REFUND_RECONCILIATION_CANDIDATES_SQL, [size])
  ).rows;
  const remaining = size - invoices.length;
  const credits = remaining
    ? (await pool.query<Orphan>(orphanSql + ' ORDER BY c.id LIMIT $1', [remaining])).rows
    : [];
  const result = {
    scanned: invoices.length + credits.length,
    reported: 0,
    skipped: 0,
    truncated: invoices.length + credits.length === size,
    errors: [] as string[],
  };
  const candidates = [
    ...invoices.map((row) => ({ kind: 'invoice' as const, ...row })),
    ...credits.map((row) => ({ kind: 'credit' as const, ...row })),
  ];
  for (const candidate of candidates) {
    let client: PoolClient | undefined;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      // Refund requests, completion and retry all serialize on the invoice.
      // Orphan credits have no parent; their wallet lock protects the recheck.
      const table = candidate.kind === 'invoice' ? 'invoices' : 'wallets';
      const column = candidate.kind === 'invoice' ? 'id' : 'profile_id';
      const identity = candidate.kind === 'invoice' ? candidate.id : candidate.wallet_id;
      if (
        !(
          await client.query(
            `SELECT ${column} FROM ${table} WHERE ${column}=$1 FOR UPDATE SKIP LOCKED`,
            [identity]
          )
        ).rows.length
      ) {
        result.skipped++;
        await client.query('ROLLBACK');
        continue;
      }
      let details: Record<string, unknown> | undefined;
      if (candidate.kind === 'invoice') {
        const s = (
          await client.query<Snapshot>(
            `SELECT s.* FROM (${snapshotSql('WHERE id=$1')}) s WHERE ${activeInvoice}`,
            [candidate.id]
          )
        ).rows[0];
        if (s) {
          const completed = parseLedgerAmount(s.completed),
            returned = parseLedgerAmount(s.refunded_amount),
            reserved = parseLedgerAmount(s.reserved),
            paid = parseLedgerAmount(s.paid_amount),
            invalid = parseLedgerAmount(s.invalid_count);
          const reservationsExceeded = s.adjustment_kind !== 'credit' && reserved + returned > paid;
          if (completed > returned || invalid > 0n || reservationsExceeded)
            details = {
              source: 'refund_accounting',
              invoiceId: s.id,
              walletId: s.profile_id,
              paidAmount: paid.toString(),
              refundedAmount: returned.toString(),
              completedRefunds: completed.toString(),
              outstandingReservations: reserved.toString(),
              completedExceedsCounter: completed > returned,
              reservationsExceeded,
              paidCapacityApplicable: s.adjustment_kind !== 'credit',
              invalidRefundCount: invalid.toString(),
              invalidRefundIds: s.invalid_ids,
              invalidRefundIdsTruncated: invalid > BigInt(s.invalid_ids.length),
              legacyCompletedWithoutIntent: s.legacy_completed_count,
            };
        }
      } else {
        const s = (await client.query<Orphan>(orphanSql + ' AND c.id=$1', [candidate.id])).rows[0];
        if (s)
          details = {
            source: 'refund_credit',
            reason: 'orphan_refund_credit',
            transactionId: s.id,
            walletId: s.wallet_id,
            amount: s.amount,
            idempotencyHash: createHash('sha256').update(s.idempotency_key).digest('hex'),
          };
      }
      if (!details) {
        result.skipped++;
        await client.query('ROLLBACK');
        continue;
      }
      await client.query(
        `INSERT INTO reconciliation_exceptions(exception_type,severity,status,description,details)
        VALUES('payment_mismatch','high','open',$1,$2::jsonb)`,
        [
          candidate.kind === 'invoice'
            ? `Refund accounting/provenance mismatch: ${candidate.id}`
            : `Orphan refund wallet credit: ${candidate.id}`,
          JSON.stringify(details),
        ]
      );
      await client.query('COMMIT');
      result.reported++;
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => {});
      result.errors.push(
        `${candidate.id}: ${error instanceof Error ? error.message : 'Refund reconciliation failed'}`
      );
    } finally {
      client?.release();
    }
  }
  return result;
}
