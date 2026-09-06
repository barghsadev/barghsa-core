import type { QueryResultRow } from 'pg';
import {
  decideDeliverySchedule,
  loadDeliveryWindowConfig,
  normalizeWindowConfig,
  type DeliveryWindowConfig,
} from './delivery-window.js';
import type { NotificationChannel } from '@barghsa/shared/notifications';

type QueryConnection = {
  query: (
    sql: string,
    params?: unknown[]
  ) => Promise<{ rows: QueryResultRow[]; rowCount?: number | null }>;
};
export type QueryPool = QueryConnection & {
  connect?: () => Promise<QueryConnection & { release: (destroy?: boolean) => void }>;
};
export interface ChannelJob {
  channel: NotificationChannel;
  status: string;
  attempts?: number;
  max_attempts?: number;
  run_after: Date | string | null;
  last_error?: string | null;
  delivery_window?: DeliveryWindowConfig | null;
}
export function terminalJob(job: ChannelJob): boolean {
  return ['done', 'failed', 'dead_letter'].includes(job.status);
}

/** Derive aggregate status from channel jobs, never from just this attempt. */
export async function refreshOutboxState(
  pool: QueryPool,
  id: string,
  now = new Date()
): Promise<'delivered' | 'failed' | 'pending'> {
  const jobs: ChannelJob[] = (
    await pool.query(
      'SELECT channel,status,attempts,max_attempts,run_after,last_error FROM notification_job WHERE outbox_id=$1',
      [id]
    )
  ).rows as ChannelJob[];
  if (!jobs.length) throw new Error('notification outbox has no channel jobs');
  const pending = jobs.filter((job) => !terminalJob(job));
  const failed = jobs.some(
    (job) =>
      job.status === 'dead_letter' ||
      (job.status === 'failed' && !job.last_error?.startsWith('skipped:'))
  );
  const next = pending.length
    ? new Date(
        Math.min(
          ...pending.map((job) =>
            job.run_after ? new Date(job.run_after).getTime() : now.getTime()
          )
        )
      )
    : null;
  const status = pending.length
    ? next! > now
      ? 'scheduled'
      : 'queued'
    : failed
      ? 'failed'
      : 'delivered';
  await pool.query(
    `UPDATE notification_outbox SET status=$2, scheduled_for=$3, locked_until=NULL,lease_token=NULL,
    attempts=$4,last_error=$5,updated_at=NOW() WHERE id=$1`,
    [
      id,
      status,
      next,
      Math.max(0, ...jobs.map((job) => Number(job.attempts ?? 0))),
      jobs.find(
        (job) => job.status !== 'done' && job.last_error && !job.last_error.startsWith('skipped:')
      )?.last_error ?? null,
    ]
  );
  return pending.length ? 'pending' : failed ? 'failed' : 'delivered';
}

/** Keep future dates; when a leg wakes, evaluate its recipient's window again. */
export async function reconcileChannelWindows(
  pool: QueryPool,
  config?: DeliveryWindowConfig,
  now = new Date()
): Promise<number> {
  const cfg = config ?? (await loadDeliveryWindowConfig(pool));
  const pending = await pool.query(
    `SELECT o.id,o.event_key,o.channels,o.status,o.scheduled_for,u.timezone,
    (SELECT jsonb_agg(jsonb_build_object('channel',j.channel,'status',j.status,'run_after',j.run_after,'delivery_window',j.delivery_window))
      FROM notification_job j WHERE j.outbox_id=o.id) AS jobs
    FROM notification_outbox o LEFT JOIN profiles p ON p.id=o.profile_id
    LEFT JOIN users u ON u.user_id=COALESCE(o.user_id,p.user_id)
    WHERE o.status IN ('queued','scheduled','sending') AND (o.locked_until IS NULL OR o.locked_until<=clock_timestamp())
      AND (o.scheduled_for IS NULL OR o.scheduled_for<=$1 OR EXISTS (
        SELECT 1 FROM notification_job j WHERE j.outbox_id=o.id AND j.channel='in_app'
          AND j.status IN ('queued','retrying') AND (j.run_after IS NULL OR j.run_after<=$1)))
    ORDER BY o.created_at,o.id LIMIT 500`,
    [now]
  );
  let changed = 0;
  for (const candidate of pending.rows) {
    const client = pool.connect ? await pool.connect() : null;
    const q = client ?? pool;
    try {
      let row = candidate;
      if (client) {
        await client.query('BEGIN');
        const locked = await client.query(
          `SELECT o.*,
          (SELECT u.timezone FROM users u WHERE u.user_id=COALESCE(o.user_id,(SELECT p.user_id FROM profiles p WHERE p.id=o.profile_id))) AS timezone,
          (SELECT jsonb_agg(jsonb_build_object('channel',j.channel,'status',j.status,'run_after',j.run_after,'delivery_window',j.delivery_window)) FROM notification_job j WHERE j.outbox_id=o.id) AS jobs
          FROM notification_outbox o WHERE o.id=$1 AND o.status IN ('queued','scheduled','sending')
            AND (o.locked_until IS NULL OR o.locked_until<=clock_timestamp()) FOR UPDATE SKIP LOCKED`,
          [candidate.id]
        );
        if (!locked.rows.length) {
          await client.query('ROLLBACK');
          continue;
        }
        row = locked.rows[0]!;
      }
      const jobs: ChannelJob[] = row.jobs ?? [];
      if (!jobs.length) {
        if (client) await client.query('COMMIT');
        continue;
      }
      const recipientConfig = normalizeWindowConfig({
        ...cfg,
        timezone: row.timezone ?? cfg.timezone,
      });
      // Direct test overrides can intentionally use a full-day window.
      if (config) {
        recipientConfig.startHour = config.startHour;
        recipientConfig.endHour = config.endHour;
      }
      let adjusted = false;
      for (const job of jobs) {
        if (terminalJob(job) || (job.run_after && new Date(job.run_after) > now)) continue;
        const previousBoundary =
          row.status === 'scheduled' && row.scheduled_for && new Date(row.scheduled_for) > now
            ? new Date(row.scheduled_for)
            : null;
        const savedWindow = job.delivery_window
          ? normalizeWindowConfig(job.delivery_window)
          : recipientConfig;
        const decision = decideDeliverySchedule(row.event_key, [job.channel], now, savedWindow);
        const next =
          job.channel !== 'in_app' && previousBoundary
            ? previousBoundary
            : decision.kind === 'schedule'
              ? decision.scheduledFor
              : null;
        if (next) {
          await q.query(
            `UPDATE notification_job SET run_after=$3,delivery_window=COALESCE(delivery_window,$5::jsonb),updated_at=NOW()
            WHERE outbox_id=$1 AND channel=$2 AND status IN ('queued','retrying')
              AND (run_after IS NULL OR run_after<=$4)`,
            [row.id, job.channel, next, now, JSON.stringify(savedWindow)]
          );
          adjusted = true;
        }
      }
      // In-app remains immediately runnable even when external jobs are parked.
      await refreshOutboxState(q, row.id, now);
      if (adjusted) changed++;
      if (client) await client.query('COMMIT');
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      throw error;
    } finally {
      client?.release();
    }
  }
  return changed;
}
