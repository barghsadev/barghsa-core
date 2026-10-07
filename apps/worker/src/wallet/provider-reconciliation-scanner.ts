import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { getDbPool } from '@barghsa/db';
import { ONLINE_TOPUP_EXPIRY_REASON, parseOnlineTopUpPendingTtlMs } from '@barghsa/shared/finance';

export const PROVIDER_RECONCILIATION_JOB_TYPE = 'provider_reconciliation_scan';
export const DEFAULT_PROVIDER_RECONCILIATION_INTERVAL_MS = 60 * 60 * 1000;
export const PROVIDER_PROCESSING_STALE_MS = 15 * 60 * 1000;

// Explicit projections omit verified raw JSON, bank data and provider credentials.
// Use the identical projection for selection and the locked recheck.
const projection = `
  SELECT 'callback' AS kind,e.id,e.event_id,e.pending_transaction_id::text AS identity,e.created_at,
    CASE WHEN p.type IS DISTINCT FROM 'topup' OR p.metadata->>'channel' IS DISTINCT FROM 'online'
      OR e.wallet_id IS DISTINCT FROM p.wallet_id
      OR (e.status IN ('credited','duplicate') AND (
        c.type IS DISTINCT FROM 'topup' OR c.state IS DISTINCT FROM 'Completed'
        OR c.wallet_id IS DISTINCT FROM p.wallet_id OR c.amount IS DISTINCT FROM p.amount OR c.amount<=0
        OR (c.metadata ? 'channel' AND c.metadata->>'channel' IS DISTINCT FROM 'online')
        OR (c.metadata ? 'pendingTransactionId'
          AND lower(c.metadata->>'pendingTransactionId') IS DISTINCT FROM p.id::text)))
      THEN 'credit_mismatch'
      WHEN e.status='processing' AND e.created_at<$1 THEN 'stalled_processing' END AS reason,
    jsonb_build_object('providerStatus',e.status,'walletId',e.wallet_id,'intentWalletId',p.wallet_id,'creditWalletId',c.wallet_id,
      'pendingTransactionId',p.id,'creditTransactionId',c.id,
      'intentAmount',p.amount::text,'creditAmount',c.amount::text) AS details
  FROM wallet_topup_callback_events e JOIN wallet_transactions p ON p.id=e.pending_transaction_id
  LEFT JOIN wallet_transactions c ON c.idempotency_key='wallet-online-topup-credit:'||p.id::text
  UNION ALL
  SELECT 'chargeback',e.id,e.event_id,e.event_id,e.created_at,
    CASE WHEN e.status IN ('unmatched','unresolved') THEN e.status
      WHEN e.status='reversed' AND (
        o.type IS DISTINCT FROM 'topup' OR o.state IS DISTINCT FROM 'Completed' OR o.amount<=0
        OR o.metadata->>'channel' IS DISTINCT FROM 'online'
        OR e.wallet_id IS DISTINCT FROM o.wallet_id
        OR r.type IS DISTINCT FROM 'reversal' OR r.state IS DISTINCT FROM 'Completed'
        OR r.wallet_id IS DISTINCT FROM o.wallet_id
        OR r.reverses_transaction_id IS DISTINCT FROM o.id
        OR r.amount::numeric IS DISTINCT FROM -(o.amount::numeric)) THEN 'reversal_mismatch'
      WHEN e.status='processing' AND e.created_at<$1 THEN 'stalled_processing' END,
    jsonb_build_object('providerStatus',e.status,'walletId',e.wallet_id,'originalWalletId',o.wallet_id,'reversalWalletId',r.wallet_id,
      'originalTransactionId',e.original_transaction_id,'reversalTransactionId',e.reversal_transaction_id,
      'originalAmount',o.amount::text,'reversalAmount',r.amount::text)
  FROM wallet_chargeback_events e LEFT JOIN wallet_transactions o ON o.id=e.original_transaction_id
  LEFT JOIN wallet_transactions r ON r.id=e.reversal_transaction_id
  UNION ALL
  SELECT 'intent',p.id,NULL,p.id::text,p.created_at,
    CASE WHEN (p.state='Pending' AND p.created_at<$2)
      OR (p.state='Rejected' AND p.metadata->'expiry'->>'reason'='${ONLINE_TOPUP_EXPIRY_REASON}')
      THEN 'expired_intent' END,
    jsonb_build_object('walletId',p.wallet_id,'pendingTransactionId',p.id,
      'intentState',p.state,'intentAmount',p.amount::text)
  FROM wallet_transactions p WHERE p.type='topup' AND p.metadata->>'channel'='online'`;

const unseen = `NOT EXISTS (SELECT 1 FROM reconciliation_exceptions e
  WHERE e.exception_type='payment_mismatch' AND e.details->>'source'='provider_'||s.kind
    AND e.details->>'recordId'=s.id::text AND e.details->>'reason'=s.reason)`;

export const FIND_PROVIDER_RECONCILIATION_CANDIDATES_SQL = `SELECT s.kind,s.id,s.identity
  FROM (${projection}) s WHERE s.reason IS NOT NULL AND ${unseen}
  ORDER BY s.created_at,s.id,s.kind LIMIT $3`;

type Kind = 'callback' | 'chargeback' | 'intent';
interface Candidate {
  kind: Kind;
  id: string;
  identity: string;
}
interface Snapshot extends Candidate {
  event_id: string | null;
  reason: string | null;
  details: Record<string, unknown>;
}

/** Match the provider handlers' session advisory lock namespaces and signed keys.
 * A transaction-scoped try-lock skips active PSP calls instead of reporting them. */
function lockKeys(row: Candidate): [number, number] {
  const prefix = row.kind === 'chargeback' ? 'wallet-chargeback:' : 'wallet-online-topup-callback:';
  const hash = createHash('sha256')
    .update(prefix + row.identity)
    .digest();
  return [hash.readInt32BE(0), hash.readInt32BE(4)];
}

export async function reconcileProviderTransactions(
  options: {
    pool?: Pool;
    batchSize?: number;
    now?: Date;
    staleMs?: number;
    ttlMs?: number;
  } = {}
) {
  const size = options.batchSize ?? 200;
  const staleMs = options.staleMs ?? PROVIDER_PROCESSING_STALE_MS;
  const ttlMs =
    options.ttlMs ?? parseOnlineTopUpPendingTtlMs(process.env['ONLINE_TOPUP_PENDING_TTL_MS']);
  const now = options.now ?? new Date();
  if (!Number.isSafeInteger(size) || size < 1 || size > 1000)
    throw new RangeError('Provider reconciliation batch size must be between 1 and 1000');
  if (
    ![staleMs, ttlMs].every((v) => Number.isSafeInteger(v) && v >= 1000) ||
    !Number.isFinite(now.getTime())
  )
    throw new RangeError('Provider reconciliation clock and age limits must be valid');
  const cutoffs = [new Date(now.getTime() - staleMs), new Date(now.getTime() - ttlMs)];
  if (cutoffs.some((v) => !Number.isFinite(v.getTime())))
    throw new RangeError('Provider reconciliation cutoff is invalid');
  const pool = options.pool ?? getDbPool();
  const candidates = (
    await pool.query<Candidate>(FIND_PROVIDER_RECONCILIATION_CANDIDATES_SQL, [...cutoffs, size])
  ).rows;
  const result = {
    scanned: candidates.length,
    reported: 0,
    skipped: 0,
    truncated: candidates.length === size,
    errors: [] as string[],
  };
  for (const candidate of candidates) {
    let client: PoolClient | undefined;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      if (
        !(
          await client.query<{ locked: boolean }>(
            'SELECT pg_try_advisory_xact_lock($1,$2) AS locked',
            lockKeys(candidate)
          )
        ).rows[0]?.locked
      ) {
        result.skipped++;
        await client.query('ROLLBACK');
        continue;
      }
      const table =
        candidate.kind === 'callback'
          ? 'wallet_topup_callback_events'
          : candidate.kind === 'chargeback'
            ? 'wallet_chargeback_events'
            : 'wallet_transactions';
      if (
        !(
          await client.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE SKIP LOCKED`, [
            candidate.id,
          ])
        ).rows.length
      ) {
        result.skipped++;
        await client.query('ROLLBACK');
        continue;
      }
      const snapshot = (
        await client.query<Snapshot>(
          `SELECT s.* FROM (${projection}) s
        WHERE s.kind=$3 AND s.id=$4::uuid AND s.reason IS NOT NULL AND ${unseen}`,
          [...cutoffs, candidate.kind, candidate.id]
        )
      ).rows[0];
      if (!snapshot) {
        result.skipped++;
        await client.query('ROLLBACK');
        continue;
      }
      await client.query(
        `INSERT INTO reconciliation_exceptions(exception_type,severity,status,description,details)
        VALUES('payment_mismatch',$1,'open',$2,$3::jsonb)`,
        [
          candidate.kind === 'chargeback' || snapshot.reason?.endsWith('mismatch')
            ? 'high'
            : 'medium',
          `Provider ${candidate.kind} reconciliation: ${snapshot.reason}`,
          JSON.stringify({
            ...snapshot.details,
            source: 'provider_' + candidate.kind,
            recordId: snapshot.id,
            reason: snapshot.reason,
            ...(snapshot.event_id
              ? { eventHash: createHash('sha256').update(snapshot.event_id).digest('hex') }
              : {}),
          }),
        ]
      );
      await client.query('COMMIT');
      result.reported++;
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => {});
      result.errors.push(
        `${candidate.id}: ${error instanceof Error ? error.message : 'Provider reconciliation failed'}`
      );
    } finally {
      client?.release();
    }
  }
  return result;
}
