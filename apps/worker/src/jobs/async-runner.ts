import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

interface LeasedJob {
  id: string;
  type: string;
  payload: unknown;
  lease_token: string;
}

export interface JobContext {
  jobId: string;
  leaseToken: string;
  setProgress(percentage: number): Promise<void>;
}
export type JobHandler = (
  payload: unknown,
  context: JobContext
) => Promise<{ resultUrl?: string } | void>;

/** Register trusted handlers at worker startup; job payloads never choose executable code. */
export class JobHandlerRegistry {
  private readonly handlers = new Map<string, JobHandler>();

  register(type: string, handler: JobHandler): void {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(type) || this.handlers.has(type))
      throw new Error('Invalid or duplicate async job handler');
    this.handlers.set(type, handler);
  }

  get(type: string): JobHandler | undefined {
    return this.handlers.get(type);
  }

  types(): string[] {
    return [...this.handlers.keys()];
  }
}

/** Claim at most one job atomically across replicas, with a renewable crash-recovery lease. */
export async function runOneAsyncJob(
  pool: Pick<Pool, 'query'>,
  registry: JobHandlerRegistry
): Promise<boolean> {
  const types = registry.types();
  if (types.length === 0) return false;
  await pool.query(
    `UPDATE async_jobs SET status='failed',error_message='JOB_INTERRUPTED',
       lease_token=NULL,lease_until=NULL,completed_at=now()
     WHERE type=ANY($1::text[]) AND status='processing' AND lease_until < now() AND attempts >= 3`,
    [types]
  );
  const token = randomUUID();
  const claimed = await pool.query<LeasedJob>(
    `WITH candidate AS (
       SELECT id FROM async_jobs
       WHERE type=ANY($2::text[]) AND
         (status='queued' OR (status='processing' AND lease_until < now() AND attempts < 3))
       ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
     )
     UPDATE async_jobs j SET status='processing',lease_token=$1,
       lease_until=now()+interval '60 seconds',attempts=j.attempts+1,
       progress_pct=0,started_at=COALESCE(j.started_at,now())
     FROM candidate WHERE j.id=candidate.id
     RETURNING j.id,j.type,j.payload,j.lease_token`,
    [token, types]
  );
  const job = claimed.rows[0];
  if (!job) return false;

  let leaseLost = false;
  const renew = async () => {
    const result = await pool.query(
      `UPDATE async_jobs SET lease_until=now()+interval '60 seconds'
       WHERE id=$1 AND status='processing' AND lease_token=$2`,
      [job.id, token]
    );
    if (result.rowCount !== 1) leaseLost = true;
  };
  const heartbeat = setInterval(() => {
    void renew().catch(() => {
      leaseLost = true;
    });
  }, 20_000);
  heartbeat.unref();

  try {
    const handler = registry.get(job.type);
    if (!handler) throw new Error('Missing async job handler');
    const output = await handler(job.payload, {
      jobId: job.id,
      leaseToken: token,
      async setProgress(percentage) {
        if (!Number.isInteger(percentage) || percentage < 0 || percentage > 99)
          throw new Error('Invalid job progress');
        const result = await pool.query(
          `UPDATE async_jobs SET progress_pct=$3
           WHERE id=$1 AND status='processing' AND lease_token=$2`,
          [job.id, token, percentage]
        );
        if (result.rowCount !== 1) throw new Error('Async job lease lost');
      },
    });
    const resultUrl = output?.resultUrl ?? null;
    if (resultUrl !== null && (!resultUrl.startsWith('/') || resultUrl.startsWith('//')))
      throw new Error('Invalid job result URL');
    if (leaseLost) throw new Error('Async job lease lost');
    await pool.query(
      `UPDATE async_jobs SET status='completed',progress_pct=100,result_url=$3,
         error_message=NULL,lease_token=NULL,lease_until=NULL,completed_at=now()
       WHERE id=$1 AND status='processing' AND lease_token=$2`,
      [job.id, token, resultUrl]
    );
  } catch {
    // Never store handler exceptions, which may contain credentials or customer data.
    await pool.query(
      `UPDATE async_jobs SET status='failed',error_message='JOB_FAILED',
         lease_token=NULL,lease_until=NULL,completed_at=now()
       WHERE id=$1 AND status='processing' AND lease_token=$2`,
      [job.id, token]
    );
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}
