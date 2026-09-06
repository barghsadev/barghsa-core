import type { OutboxRow } from './outbox-reader.js';

type QueryPool = { query: (sql: string, params?: any[]) => Promise<any> };
export class OutboxLeaseLost extends Error {
  constructor() {
    super('notification outbox claim is no longer owned');
  }
}

/** Hold the row lock until the caller commits its job/outbox transaction. */
export async function assertOutboxClaim(pool: QueryPool, row: OutboxRow): Promise<void> {
  if (!row.leaseToken) throw new OutboxLeaseLost();
  const owned = await pool.query(
    `SELECT id FROM notification_outbox
    WHERE id=$1 AND lease_token=$2 AND status='sending' AND locked_until>clock_timestamp()
    FOR UPDATE`,
    [row.id, row.leaseToken]
  );
  if (!owned.rows.length) throw new OutboxLeaseLost();
}

export interface OutboxLease {
  signal: AbortSignal;
  beforeSend: () => Promise<void>;
  stop: () => Promise<void>;
}

export async function startOutboxLease(
  pool: QueryPool,
  row: OutboxRow,
  durationMs: number
): Promise<OutboxLease> {
  if (!row.leaseToken) throw new OutboxLeaseLost();
  const controller = new AbortController();
  let lost = false;
  let stopped = false;
  let pending: Promise<void> | null = null;
  async function renew() {
    try {
      const result = await pool.query(
        `UPDATE notification_outbox SET status = 'sending',
        locked_until=clock_timestamp()+$3*INTERVAL '1 millisecond',updated_at=NOW()
        WHERE id=$1 AND lease_token=$2 AND locked_until>clock_timestamp()
          AND status IN ('queued','scheduled','sending') RETURNING id`,
        [row.id, row.leaseToken, durationMs]
      );
      if (!result.rows.length) throw new OutboxLeaseLost();
    } catch {
      lost = true;
      controller.abort();
      throw new OutboxLeaseLost();
    }
  }
  await renew();
  const timer = setInterval(
    () => {
      if (stopped || pending || lost) return;
      pending = renew()
        .catch(() => {})
        .finally(() => {
          pending = null;
        });
    },
    Math.max(25, Math.floor(durationMs / 3))
  );
  timer.unref();
  return {
    signal: controller.signal,
    async beforeSend() {
      if (lost || stopped) throw new OutboxLeaseLost();
      // Recheck immediately before every channel, including after a slow leg.
      await renew();
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      await pending;
    },
  };
}
