import {
  withReminderDeliveryPolicy,
  type ReminderDeliveryPolicy,
} from '../invoices/reminder-delivery-policy.js';
import { decideDeliverySchedule } from './delivery-window.js';
import type { QueryPool } from './channel-scheduling.js';
import type { QueryResultRow } from 'pg';
import { getDbPool } from '@barghsa/db';
import type { INotificationTransport, NotificationChannel } from '@barghsa/shared/notifications';
import {
  leaseOutbox,
  dispatchOutbox,
  normalizeLeaseDurationMs,
  type OutboxRow,
  type OutboxReaderOptions,
  type WorkerNotificationTransport,
} from './outbox-reader.js';
import { assertOutboxClaim, OutboxLeaseLost, startOutboxLease } from './outbox-lease.js';
import {
  refreshOutboxState,
  reconcileChannelWindows,
  terminalJob,
  type ChannelJob,
} from './channel-scheduling.js';
import { nextRetryDelayMs } from './retry-schedule.js';
import { writeDeliveryLog, classifyDeliveryError } from './delivery-log.js';
import { writeDeadLetter } from './dead-letter.js';
import { sanitizeError } from './error-redact.js';
import { recordDeliveryAttempt } from './worker-metrics.js';
import { DeliveryOutcomeUnknown, readDeliveryReceipt } from './send-receipt.js';
import { type DeliveryWindowConfig } from './delivery-window.js';
import {
  resolveChannelAvailability,
  type ChannelAvailabilityContext,
} from './channel-availability.js';
import {
  loadChannelAvailabilityContext,
  EMPTY_AVAILABILITY_CONTEXT,
} from './channel-availability-loader.js';

/**
 * Outbox dispatch runner (E-05, T-05.01.02 / T-05.01.03).
 *
 * Ties the durable write pipeline together on the consuming side:
 * each poll leases due outbox rows (`leaseOutbox`), marks them `sending`,
 * dispatches every requested channel through the registered transports
 * (`dispatchOutbox`), then records the outcome on each per-channel
 * `notification_job` row and the aggregate outcome on the outbox row.
 *
 * Lifecycle handled here:
 *   queued/scheduled → sending (leased) → delivered | dead_letter | retrying
 *
 * - A retry-eligible row (attempts < maxAttempts) is returned to `queued` with
 *   a `locked_until` back-off drawn from the T-05.01.03 retry ladder
 *   (1min → 5min → 30min → 2hr) with ±20% jitter, so it is not re-leased on
 *   the very next poll tick.
 * - A row whose attempts reach `max_attempts` is marked `failed` permanently
 *   and its per-channel jobs move to `dead_letter` for review / retry / resolve.
 * - `max_attempts` is configurable per notification type (see retry-schedule).
 * - `last_error` is sanitized before persistence so provider messages can
 *   never leak credentials or connection strings.
 */
export interface OutboxRunResult {
  /** Number of outbox rows claimed in this poll. */
  leased: number;
  /** Number of rows whose channels all delivered. */
  delivered: number;
  /** Number of rows that failed (or are retrying) at least one channel. */
  failed: number;
}

/**
 * Redact + cap a persisted error. Kept as an alias of the shared sanitizer so
 * existing callers (and tests) importing `sanitizeLastError` from this module
 * keep working. See `./error-redact.ts`.
 */
export const sanitizeLastError = sanitizeError;

export async function runOutboxPoll(
  options?: OutboxReaderOptions & {
    /** Override the pool for tests. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pool?: any;
    /** Override the delivery-window config for tests. */
    deliveryWindow?: DeliveryWindowConfig;
    /**
     * Override for the channel-availability gate (T-05.05.02). When omitted,
     * the worker loads the recipient's verified destinations + marketing
     * consent from the DB for every leased row. A caller may inject a
     * resolver/pre-loaded context for deterministic tests.
     */
    availability?: (
      row: OutboxRow
    ) => Promise<ChannelAvailabilityContext> | ChannelAvailabilityContext;
  }
): Promise<OutboxRunResult> {
  const pool = options?.pool ?? getDbPool();
  // Schedule due external jobs independently from in-app and derive the
  // aggregate outbox wake-up from the earliest pending channel.
  await reconcileDeliveryWindows(pool, options?.deliveryWindow);
  const rows = await leaseOutbox(options);

  const result: OutboxRunResult = { leased: rows.length, delivered: 0, failed: 0 };
  if (rows.length === 0) return result;

  const settled = await Promise.allSettled(
    rows.map(async (row) => {
      let lease: Awaited<ReturnType<typeof startOutboxLease>> | undefined;
      let externalOutcomes: DispatchOutcome[] = [];
      try {
        lease = await startOutboxLease(
          pool,
          row,
          normalizeLeaseDurationMs(options?.leaseDurationMs)
        );
        const channelJobs: ChannelJob[] = (
          await pool.query(
            'SELECT channel,status,attempts,max_attempts,run_after,last_error FROM notification_job WHERE outbox_id=$1',
            [row.id]
          )
        ).rows;
        const pendingChannels = channelJobs
          .filter(
            (job) => !terminalJob(job) && (!job.run_after || new Date(job.run_after) <= new Date())
          )
          .map((job) => job.channel);
        // Recover committed acceptance, or hold an ambiguous send, before
        // current recipient/channel policy can hide the previous attempt.
        const recovered: DispatchOutcome[] = [];
        for (const channel of pendingChannels) {
          if (channel === 'in_app') continue;
          try {
            const receipt = await readDeliveryReceipt(pool, row.id, channel);
            if (receipt) recovered.push({ channel, result: receipt, latencyMs: null });
          } catch (error) {
            if (!(error instanceof DeliveryOutcomeUnknown)) throw error;
            recovered.push({
              channel,
              result: { status: 'failed', providerRef: '' },
              latencyMs: null,
              error: error.message,
              requiresReconciliation: true,
            });
          }
        }
        externalOutcomes = recovered.slice();
        const remainingChannels = pendingChannels.filter(
          (channel) => !recovered.some((outcome) => outcome.channel === channel)
        );
        const activeLease = lease;
        const finish = async (policy: ReminderDeliveryPolicy) => {
          const deferred: { channel: NotificationChannel; until: Date }[] = [];
          const policySkipped: { channel: NotificationChannel; reason: string }[] = [];
          const eligible = remainingChannels.filter((channel) => {
            if (policy.skipReason) {
              policySkipped.push({ channel, reason: policy.skipReason });
              return false;
            }
            let until = policy.deferUntil;
            if (!until && policy.window) {
              const window = decideDeliverySchedule(
                row.eventKey,
                [channel],
                new Date(),
                policy.window
              );
              if (window.kind === 'schedule') until = window.scheduledFor;
            }
            if (until) {
              deferred.push({ channel, until });
              return false;
            }
            return true;
          });
          const availability =
            eligible.length === 0
              ? EMPTY_AVAILABILITY_CONTEXT
              : (options?.availability?.(row) ?? loadChannelAvailabilityContext(pool, row.id));
          const ctx = (await availability) ?? EMPTY_AVAILABILITY_CONTEXT;
          const decision = resolveChannelAvailability(row.eventKey, eligible, ctx);
          const outcomes = [
            ...recovered,
            ...(await dispatchOutbox(
              { ...row, channels: decision.allowed.filter((channel) => channel !== 'in_app') },
              options?.transports ?? {},
              activeLease
            )),
          ];
          // A rollback cannot undo an external send. Retain its actual receipt
          // if recording the combined inbox/outcome transaction needs another try.
          externalOutcomes = outcomes.slice();
          if (activeLease.signal.aborted) throw new OutboxLeaseLost();
          const aggregate = await persistOutcomes(
            pool,
            row,
            outcomes,
            channelJobs,
            [...decision.skipped, ...policySkipped],
            decision.allowed.includes('in_app') ? (options?.transports ?? {}) : undefined,
            deferred
          );
          if (
            outcomes.some((outcome) => outcome.result.status === 'failed') ||
            aggregate === 'failed'
          )
            result.failed++;
          else if (aggregate === 'delivered') result.delivered++;
        };
        if (remainingChannels.length)
          await withReminderDeliveryPolicy(pool, row, finish, options?.deliveryWindow);
        else await finish({});
      } catch (error) {
        if (!(error instanceof OutboxLeaseLost)) {
          const message = sanitizeLastError(error instanceof Error ? error.message : String(error));
          try {
            const jobs: ChannelJob[] = (
              await pool.query(
                'SELECT channel,status,attempts,max_attempts,run_after,last_error FROM notification_job WHERE outbox_id=$1',
                [row.id]
              )
            ).rows;
            const due = jobs.filter(
              (job) =>
                !terminalJob(job) && (!job.run_after || new Date(job.run_after) <= new Date())
            );
            await persistOutcomes(
              pool,
              row,
              due.map(
                (job) =>
                  externalOutcomes.find((outcome) => outcome.channel === job.channel) ?? {
                    channel: job.channel,
                    result: { status: 'failed', providerRef: '' },
                    latencyMs: null,
                    error: message,
                  }
              ),
              jobs
            );
          } catch (recordingError) {
            if (!(recordingError instanceof OutboxLeaseLost)) throw recordingError;
          }
        }
        // A stale claimant never changes current jobs, logs, or aggregate state.
        result.failed++;
      } finally {
        await lease?.stop();
      }
    })
  );
  const failures = settled.filter(
    (entry): entry is PromiseRejectedResult => entry.status === 'rejected'
  );
  if (failures.length)
    throw new AggregateError(
      failures.map((entry) => entry.reason),
      'Notification persistence failed'
    );

  return result;
}

interface DispatchOutcome {
  channel: NotificationChannel;
  result: { providerRef: string; status: 'delivered' | 'failed' };
  /** Provider round-trip latency in milliseconds for this attempt. */
  latencyMs: number | null;
  error?: string;
  requiresReconciliation?: boolean;
}

/**
 * Mark the notification_job rows for external channels that the availability
 * gate (T-05.05.02) skipped, and persist a delivery-log row describing the
 * skip. Skipped legs are recorded as `failed` with a permanent
 * `skipped:<reason>` detail so the admin panel can see exactly why an
 * external channel was not delivered — without retrying (the skipped job is
 * terminal, matching `required_channels_missing`-style permanent gating). The
 * skipped jobs are never copied to the dead-letter queue (they are not
 * retryable delivery failures) and do not block the in-app/allowed legs from
 * delivering.
 */
async function markSkippedJobs(
  pool: QueryPool,
  row: OutboxRow,
  skipped: ReadonlyArray<{ channel: NotificationChannel; reason: string }>
): Promise<void> {
  for (const skip of skipped) {
    await pool.query(
      `UPDATE notification_job
          SET status = 'failed', last_error = $3, updated_at = NOW()
        WHERE outbox_id = $1 AND channel = $2`,
      [row.id, skip.channel, `skipped: ${skip.reason}`]
    );
    await writeDeliveryLog(pool, {
      notificationId: row.id,
      channel: skip.channel,
      delivered: false,
      attemptNumber: 1,
      providerRef: null,
      latencyMs: null,
      error: `skipped: ${skip.reason}`,
      errorCategory: 'permanent',
    });
  }
}

/**
 * Run `work` inside a transaction when `pool` is a real `pg.Pool` (which
 * supports `connect()`); otherwise fall back to running the queries directly
 * against the (test) pool. Returns a bound query function and a `finish`
 * token — use `q(...)` for every statement so the whole per-row persistence is
 * atomic in production, while the fake test pool keeps working unchanged.
 */

async function withWorkerTx(pool: QueryPool): Promise<{
  q: (
    sql: string,
    params?: unknown[]
  ) => Promise<{ rows: QueryResultRow[]; rowCount?: number | null }>;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
  release: () => void;
}> {
  const client = typeof pool.connect === 'function' ? await pool.connect() : null;
  if (client) {
    try {
      await client.query('BEGIN');
    } catch (error) {
      client.release(true);
      throw error;
    }
    return {
      q: (sql, params) => client.query(sql, params),
      commit: async () => {
        await client.query('COMMIT');
      },
      rollback: async () => {
        await client.query('ROLLBACK');
      },
      release: () => client.release(),
    };
  }
  return {
    q: (sql, params) => pool.query(sql, params),
    commit: async () => undefined,
    rollback: async () => undefined,
    release: () => undefined,
  };
}

/**
 * Persist per-channel outcomes to each notification_job and derive the
 * outbox row's aggregate state. A successfully delivered job stores the real
 * provider ref returned by the transport (no synthetic values). A failed job
 * is returned to `retrying` with a T-05.01.03 backoff `run_after`, or moved
 * to `dead_letter` once its per-type attempt budget is exhausted.
 */
async function persistOutcomes(
  pool: QueryPool,
  row: OutboxRow,
  outcomes: DispatchOutcome[],
  jobs: ChannelJob[],
  skipped: ReadonlyArray<{ channel: NotificationChannel; reason: string }> = [],
  localTransports?: Partial<Record<NotificationChannel, WorkerNotificationTransport>>,
  deferred: ReadonlyArray<{ channel: NotificationChannel; until: Date }> = []
): Promise<'delivered' | 'failed' | 'pending'> {
  // All per-row persistence (inbox, job status, dead-letter, delivery log, outbox
  // state) is committed atomically on a pinned client in production.
  const tx = await withWorkerTx(pool);
  const q = tx.q;
  // Minimal pool-like surface so the shared writers route through the tx.
  const qpool: QueryPool = { query: q };
  let localOutcomes: DispatchOutcome[] = [];
  try {
    await assertOutboxClaim(qpool, row);
    if (localTransports) {
      // The parent row lock fences this write. Renewing through the pool here
      // would wait on our own transaction, so no lease callback is passed.
      localOutcomes = await dispatchOutbox(
        { ...row, channels: ['in_app'] },
        localTransports,
        undefined,
        qpool
      );
      outcomes.push(...localOutcomes);
    }
    await markSkippedJobs(qpool, row, skipped);
    for (const item of deferred) {
      await q(
        `UPDATE notification_job SET run_after=$3,updated_at=NOW()
        WHERE outbox_id=$1 AND channel=$2 AND status IN ('queued','retrying')`,
        [row.id, item.channel, item.until]
      );
    }
    for (const outcome of outcomes) {
      const job = jobs.find((item) => item.channel === outcome.channel);
      const attempts = (job?.attempts ?? row.attempts) + 1;
      const maxAttempts = job?.max_attempts ?? row.maxAttempts;
      const ok = outcome.result.status === 'delivered';
      const exhausted = outcome.requiresReconciliation === true || attempts >= maxAttempts;
      // Jittered backoff before the next attempt (null when the budget is spent).
      const runAfterMs = exhausted ? null : nextRetryDelayMs(attempts, maxAttempts);
      const runAfter = runAfterMs === null ? null : new Date(Date.now() + runAfterMs);
      const jobUpdate = await q(
        `UPDATE notification_job
            SET status = $2, provider_ref = $3, attempts = $4, last_error = $5,
                run_after = $7, updated_at = NOW()
          WHERE outbox_id = $1 AND channel = $6
          RETURNING id`,
        [
          row.id,
          ok ? 'done' : exhausted ? 'dead_letter' : 'retrying',
          ok ? outcome.result.providerRef : null,
          attempts,
          ok ? null : (outcome.error ?? 'delivery failed'),
          outcome.channel,
          runAfter,
        ]
      );
      // A job that exhausted its retry budget is copied to the dead-letter queue
      // (T-05.01.06) so the admin panel can triage it (Retry / Resolve / Dismiss).
      // Same transaction as the job status update, so a crash cannot leave a
      // 'dead_letter' job with no dead-letter row.
      if (!ok && exhausted) {
        const jobId = (jobUpdate.rows as Array<{ id: string }>)[0]?.id;
        if (jobId) {
          // Prefer the outbox row's last sanitized error (set by failRow on a
          // prior attempt) for triage; fall back to a generic description when
          // the transport reported failure without an error message.
          const cause = outcome.error ?? row.lastError ?? 'delivery failed';
          await writeDeadLetter(qpool, {
            outboxId: row.id,
            jobId,
            channel: outcome.channel,
            eventKey: row.eventKey,
            profileId: row.profileId,
            userId: row.userId,
            attempts,
            maxAttempts,
            idempotencyKey: row.idempotencyKey,
            cause,
            errorCategory: classifyDeliveryError(cause),
          });
        }
      }
      // Append a delivery log row for this attempt (T-05.01.05). The suspected
      // cause is derived from the sanitized provider message when available.
      await writeDeliveryLog(qpool, {
        notificationId: row.id,
        channel: outcome.channel,
        delivered: ok,
        attemptNumber: attempts,
        providerRef: ok ? outcome.result.providerRef : null,
        latencyMs: outcome.latencyMs ?? null,
        error: ok ? null : (outcome.error ?? 'delivery failed'),
      });
    }

    const aggregate = await refreshOutboxState(qpool, row.id);

    await tx.commit();
    tx.release();
    for (const outcome of localOutcomes)
      recordDeliveryAttempt(outcome.channel, outcome.result.status);
    return aggregate;
  } catch (err) {
    await tx.rollback();
    tx.release();
    for (const outcome of localOutcomes) recordDeliveryAttempt(outcome.channel, 'failed');
    throw err;
  }
}

/**
 * Apply quiet hours per recipient and channel. Future dates and their captured
 * windows stay intact; in-app jobs remain immediately runnable. Reconciliation
 * locks each outbox row briefly so it cannot alter a live worker claim.
 */
export async function reconcileDeliveryWindows(
  pool: QueryPool,
  config?: DeliveryWindowConfig
): Promise<number> {
  return reconcileChannelWindows(pool, config);
}

export type { OutboxReaderOptions, NotificationChannel, INotificationTransport };
