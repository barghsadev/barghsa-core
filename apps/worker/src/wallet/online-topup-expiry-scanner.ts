import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { getDbPool } from '@barghsa/db';
import {
  ONLINE_TOPUP_CHANNEL,
  ONLINE_TOPUP_EXPIRED_STATE,
  ONLINE_TOPUP_EXPIRY_AUDIT_EVENT,
  ONLINE_TOPUP_EXPIRY_REASON,
  ONLINE_TOPUP_EXPIRY_TRANSITION,
  isEligibleForOnlineTopUpExpiry,
  onlineTopUpExpiryCutoff,
  parseOnlineTopUpPendingTtlMs,
  readOnlineTopUpChannel,
  buildBankReceiptTopUpFailedNotificationPayload,
  onlineTopUpExpiryNoticeReason,
} from '@barghsa/shared/finance';

/**
 * Online top-up Pending TTL expiry scanner (S-04.2.02, T-04.2.02.07).
 *
 * Periodic worker pass that auto-rejects online `topup` ledger rows still
 * in `Pending` after the configured TTL. Pending intents never change
 * wallet balances, so rejection is a state + metadata stamp only:
 *
 * - `state` → `Rejected`
 * - `metadata.expiry` records reason, TTL, and clock (provider authority
 *   on `metadata.gateway` is preserved for later callback reconciliation)
 * - one append-only `wallet.online_topup.expired` audit row in the same
 *   transaction (actor, previous/new state, reason, correlation id)
 *
 * Bank-receipt Pendings are excluded (`metadata.channel = 'online'` only).
 *
 * Guarantees:
 * - **Eligibility re-check under lock.** A candidate is selected, then
 *   re-locked with `FOR UPDATE SKIP LOCKED` and re-validated so a
 *   concurrent provider callback cannot be overwritten.
 * - **Idempotent.** Already-Rejected (and every other non-Pending) rows
 *   never match the candidate predicate, so a re-run is a no-op.
 * - **Failure isolation.** One row's update failure is recorded and
 *   skipped; the rest of the batch still runs.
 * - **Bounded drain.** A full batch (`LIMIT`) sets `truncated` so the
 *   next tick continues oldest-created first.
 *
 * The audit `user_id` FK requires a real `users` row. Tests inject
 * `actorUserId`. Production resolves `WORKER_SYSTEM_ACTOR_USER_ID` when
 * that user exists, otherwise the oldest platform admin. A scan with no
 * resolvable actor marks nothing and reports an error (the job recorder
 * surfaces it on the failed-jobs dashboard).
 */

/** Default number of expired online top-ups claimed per tick. */
export const DEFAULT_ONLINE_TOPUP_EXPIRY_BATCH_SIZE = 200;

/** Default one-minute cadence. */
export const DEFAULT_ONLINE_TOPUP_EXPIRY_INTERVAL_MS = 60 * 1000;

/** Stable worker task key recorded in `background_jobs`. */
export const ONLINE_TOPUP_EXPIRY_JOB_TYPE = 'online_topup_expiry_scan' as const;

/** Outcome of one expiry scan. */
export interface OnlineTopUpExpiryResult {
  /** Candidate rows fetched this tick (before per-row lock/re-check). */
  scanned: number;
  /** Online top-ups successfully moved to Rejected. */
  rejected: number;
  /**
   * Candidates skipped because a concurrent worker held the row, the
   * intent was no longer eligible after lock, or the lock returned nothing.
   */
  skipped: number;
  /** True when the candidate query hit the batch cap. */
  truncated: boolean;
  /** Per-row (or actor-resolution) failure messages. */
  errors: string[];
}

/** Behavioural override hooks for tests. */
export interface OnlineTopUpExpiryOptions {
  pool?: Pool;
  now?: () => Date;
  logger?: { warn: (msg: string) => void; info: (msg: string) => void };
  batchSize?: number;
  ttlMs?: number;
  /**
   * Audit actor. When set, the users lookup is skipped (unit tests).
   * Production leaves this unset so the worker resolves a real user.
   */
  actorUserId?: string;
  /** Correlation id shared by every expiry in this tick. */
  correlationId?: string;
  /** Audit row id factory (uuid v4 by default). */
  newId?: () => string;
}

const defaultLogger = {
  warn: (msg: string): void => {
    console.warn(`[worker] ${msg}`);
  },
  info: (msg: string): void => {
    console.log(`[worker] ${msg}`);
  },
};

/**
 * Candidate selector. `wallet_transactions.state`/`type` are TEXT with
 * CHECKs (not enums), so bound text comparisons are valid. Channel is
 * the online discriminator from initiation metadata.
 */
export const FIND_EXPIRED_ONLINE_TOPUP_CANDIDATES_SQL = `SELECT id, wallet_id, type, state, created_at, metadata
        FROM wallet_transactions
        WHERE type = 'topup'
          AND state = 'Pending'
          AND metadata->>'channel' = $1
          AND created_at < $2
        ORDER BY created_at ASC, id ASC
        LIMIT $3`;

const LOCK_TOPUP_SQL = `SELECT id, wallet_id, type, state, amount::text, created_at, metadata
        FROM wallet_transactions
        WHERE id = $1
        FOR UPDATE SKIP LOCKED`;

/**
 * Compare-and-set reject. Channel is bound again so a locked row that
 * is no longer an online intent cannot be stamped Rejected.
 */
export const REJECT_EXPIRED_ONLINE_TOPUP_SQL = `UPDATE wallet_transactions
        SET state = '${ONLINE_TOPUP_EXPIRED_STATE}',
            metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
        WHERE id = $1
          AND type = 'topup'
          AND state = 'Pending'
          AND metadata->>'channel' = $3`;

const INSERT_AUDIT_SQL = `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`;

const LOOKUP_USER_SQL = `SELECT user_id FROM users WHERE user_id = $1 LIMIT 1`;

const LOOKUP_ADMIN_SQL = `SELECT user_id FROM users
        WHERE is_admin = TRUE
        ORDER BY created_at ASC
        LIMIT 1`;

interface CandidateRow {
  id: string;
  wallet_id: string;
  type: string;
  state: string;
  created_at: Date | string;
  metadata: unknown;
  amount?: string;
}

/**
 * Resolve the audit actor for a system-initiated online top-up expiry.
 *
 * Preference: explicit option (tests) → `WORKER_SYSTEM_ACTOR_USER_ID` when
 * that user exists → oldest platform admin. Null means the scan must abort.
 */
export async function resolveOnlineTopUpExpiryActor(
  pool: Pool,
  explicit?: string
): Promise<string | null> {
  if (typeof explicit === 'string' && explicit.trim() !== '') {
    return explicit;
  }
  const envId = process.env['WORKER_SYSTEM_ACTOR_USER_ID'];
  if (typeof envId === 'string' && envId.trim() !== '') {
    const found = await pool.query<{ user_id: string }>(LOOKUP_USER_SQL, [envId.trim()]);
    if (found.rows[0]) return found.rows[0].user_id;
  }
  const admin = await pool.query<{ user_id: string }>(LOOKUP_ADMIN_SQL);
  return admin.rows[0]?.user_id ?? null;
}

/**
 * Run one online top-up TTL expiry pass.
 */
export async function expireStaleOnlineTopUps(
  options: OnlineTopUpExpiryOptions = {}
): Promise<OnlineTopUpExpiryResult> {
  const pool = options.pool ?? getDbPool();
  const now = options.now?.() ?? new Date();
  const logger = options.logger ?? defaultLogger;
  const batchSize = options.batchSize ?? DEFAULT_ONLINE_TOPUP_EXPIRY_BATCH_SIZE;
  const ttlMs =
    options.ttlMs ?? parseOnlineTopUpPendingTtlMs(process.env['ONLINE_TOPUP_PENDING_TTL_MS']);
  const cutoff = onlineTopUpExpiryCutoff(now, ttlMs);
  const newId = options.newId ?? randomUUID;
  const correlationId = options.correlationId ?? newId();

  const result: OnlineTopUpExpiryResult = {
    scanned: 0,
    rejected: 0,
    skipped: 0,
    truncated: false,
    errors: [],
  };

  const actorUserId = await resolveOnlineTopUpExpiryActor(pool, options.actorUserId);
  if (actorUserId === null) {
    const message =
      'online top-up expiry aborted: no system actor (set WORKER_SYSTEM_ACTOR_USER_ID or create a platform admin)';
    result.errors.push(message);
    logger.warn(message);
    return result;
  }

  const candidates = await pool.query<CandidateRow>(FIND_EXPIRED_ONLINE_TOPUP_CANDIDATES_SQL, [
    ONLINE_TOPUP_CHANNEL,
    cutoff,
    batchSize,
  ]);
  result.scanned = candidates.rows.length;
  if (candidates.rows.length >= batchSize) {
    result.truncated = true;
  }

  for (const candidate of candidates.rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const rejected = await rejectOneExpired(client, {
        transactionId: candidate.id,
        walletId: candidate.wallet_id,
        actorUserId,
        now,
        ttlMs,
        correlationId,
        newId,
      });
      if (rejected) {
        await client.query('COMMIT');
        result.rejected += 1;
      } else {
        await client.query('ROLLBACK');
        result.skipped += 1;
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      const message = `${candidate.id}: ${(error as Error)?.message ?? String(error)}`;
      result.errors.push(message);
      logger.warn(`Online top-up expiry failed: ${message}`);
    } finally {
      client.release();
    }
  }

  return result;
}

async function rejectOneExpired(
  client: PoolClient,
  input: {
    transactionId: string;
    walletId: string;
    actorUserId: string;
    now: Date;
    ttlMs: number;
    correlationId: string;
    newId: () => string;
  }
): Promise<boolean> {
  // Match the profile-first finance lock order and bind the notice to its owner.
  const profile = (
    await client.query('SELECT user_id FROM profiles WHERE id=$1 FOR SHARE', [input.walletId])
  ).rows[0];
  const locked = await client.query<CandidateRow>(LOCK_TOPUP_SQL, [input.transactionId]);
  const row = locked.rows[0];
  if (!row) return false;
  if (
    !isEligibleForOnlineTopUpExpiry(
      {
        type: row.type,
        state: row.state,
        channel: readOnlineTopUpChannel(row.metadata),
        createdAt: row.created_at,
      },
      input.now,
      input.ttlMs
    )
  ) {
    return false;
  }
  if (row.wallet_id !== input.walletId || !profile?.user_id)
    throw new Error('Expired top-up customer unavailable');
  const user = (await client.query('SELECT locale FROM users WHERE user_id=$1', [profile.user_id]))
    .rows[0];
  if (!user || !row.amount) throw new Error('Expired top-up notice data unavailable');

  const updated = await client.query(REJECT_EXPIRED_ONLINE_TOPUP_SQL, [
    row.id,
    JSON.stringify({
      expiry: {
        rejectedAt: input.now.toISOString(),
        reason: ONLINE_TOPUP_EXPIRY_REASON,
        ttlMs: input.ttlMs,
      },
    }),
    ONLINE_TOPUP_CHANNEL,
  ]);
  if ((updated.rowCount ?? 0) !== 1) return false;

  const metadata = JSON.stringify({
    transactionId: row.id,
    walletId: row.wallet_id,
    fromState: row.state,
    toState: ONLINE_TOPUP_EXPIRED_STATE,
    transition: ONLINE_TOPUP_EXPIRY_TRANSITION,
    reason: ONLINE_TOPUP_EXPIRY_REASON,
    ttlMs: input.ttlMs,
  });

  await client.query(INSERT_AUDIT_SQL, [
    input.newId(),
    input.actorUserId,
    ONLINE_TOPUP_EXPIRY_AUDIT_EVENT,
    metadata,
    input.correlationId,
    null,
    input.now,
  ]);

  // The state trigger already stores the canonical private receipt. Enrich only
  // this transaction's fresh receipt; never enqueue another logical outcome.
  const payload = {
    ...buildBankReceiptTopUpFailedNotificationPayload({
      amount: row.amount,
      pendingTransactionId: row.id,
      reason: onlineTopUpExpiryNoticeReason(user.locale),
    }),
    expired_at: input.now.toISOString(),
  };
  const notice = await client.query<{ id: string }>(
    `UPDATE notification_outbox o SET payload=o.payload||$4::jsonb,correlation_id=$5
     WHERE o.idempotency_key=$1 AND o.user_id=$2 AND o.profile_id=$3
       AND o.event_key='payment.wallet_topup_failed' AND o.channels=ARRAY['in_app','email']
       AND o.status='queued' AND o.attempts=0 AND o.created_at=transaction_timestamp()
       AND o.payload->>'transactionId'=$6
       AND EXISTS(SELECT 1 FROM notification_job j WHERE j.outbox_id=o.id AND j.channel='email'
         AND j.status='queued' AND j.attempts=0 AND j.delivery_payload IS NULL)
       AND EXISTS(SELECT 1 FROM in_app_notifications n JOIN notification_job j ON j.outbox_id=o.id
         AND j.channel='in_app' AND j.status='done' AND j.attempts=1 AND j.provider_ref=n.id::text
         WHERE n.delivery_key='outbox:'||o.id::text AND n.profile_id=o.profile_id
           AND n.recipient_user_id=o.user_id AND n.operating_context='customer' AND n.type=o.event_key
           AND NOT n.is_read AND n.created_at=transaction_timestamp()
           AND EXISTS(SELECT 1 FROM notification_delivery_log h WHERE h.notification_id=o.id
             AND h.channel='in_app' AND h.status='delivered' AND h.attempt_number=1 AND h.provider_ref=n.id::text))
     RETURNING o.id`,
    [
      `payment.wallet_topup_failed:online:${row.id}:${profile.user_id}`,
      profile.user_id,
      row.wallet_id,
      JSON.stringify(payload),
      input.correlationId,
      row.id,
    ]
  );
  if (notice.rows.length !== 1) throw new Error('Canonical expiry receipt unavailable');
  const outboxId = notice.rows[0]!.id;
  const inbox = await client.query(
    `UPDATE in_app_notifications n SET params=o.payload,
       localized_content=jsonb_set(jsonb_set(n.localized_content,'{fa,body}',to_jsonb((n.localized_content#>>'{fa,body}')||' '||$2::text)),
         '{en,body}',to_jsonb((n.localized_content#>>'{en,body}')||' '||$3::text))
     FROM notification_outbox o WHERE o.id=$1 AND n.delivery_key='outbox:'||o.id::text
       AND n.profile_id=o.profile_id AND n.recipient_user_id=o.user_id
       AND n.operating_context='customer' AND n.type=o.event_key AND NOT n.is_read
       AND n.created_at=transaction_timestamp()`,
    [outboxId, onlineTopUpExpiryNoticeReason('fa'), onlineTopUpExpiryNoticeReason('en')]
  );
  if (inbox.rowCount !== 1) throw new Error('Expiry inbox explanation was not stored');
  const job = await client.query(
    `UPDATE notification_job j SET delivery_payload=o.payload FROM notification_outbox o
     WHERE o.id=$1 AND j.outbox_id=o.id AND j.channel='in_app' AND j.status='done' AND j.attempts=1`,
    [outboxId]
  );
  if (job.rowCount !== 1) throw new Error('Expiry inbox snapshot was not stored');

  return true;
}
