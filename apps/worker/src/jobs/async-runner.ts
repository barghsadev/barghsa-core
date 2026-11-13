import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { relativeLinkRoute } from '@barghsa/shared/notifications';
import { operatorLogTrace } from '@barghsa/shared/operator-logging';
import { extractTraceparent } from '@barghsa/shared/telemetry';
import { SpanKind, SpanStatusCode, type Tracer } from '@opentelemetry/api';

export const PROFILE_EXPORT_JOB_TYPE = 'profile-export';
const MAX_CONCURRENT_PROFILE_EXPORTS = 2;

interface LeasedJob {
  id: string;
  type: string;
  payload: unknown;
  trace_parent: string | null;
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
  pool: Pick<Pool, 'connect' | 'query'>,
  registry: JobHandlerRegistry,
  tracer?: Tracer
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
  const client = await pool.connect();
  let job: LeasedJob | undefined;
  let discardClient = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    // A separate statement gives the claim a fresh snapshot after acquiring the lock.
    const mayClaimExport =
      !types.includes(PROFILE_EXPORT_JOB_TYPE) ||
      (
        await client.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked',
          ['barghsa:profile-export:claim']
        )
      ).rows[0]?.locked === true;
    const availableTypes = mayClaimExport
      ? types
      : types.filter((type) => type !== PROFILE_EXPORT_JOB_TYPE);
    const claimed = await client.query<LeasedJob>(
      `WITH candidate AS (
         SELECT id FROM async_jobs
         WHERE type=ANY($2::text[]) AND
           (status='queued' OR (status='processing' AND lease_until < now() AND attempts < 3))
           AND (type<>$3 OR (
             SELECT count(*) FROM async_jobs active
             WHERE active.type=$3 AND active.status='processing' AND active.lease_until>=now()
           )<$4)
         ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE async_jobs j SET status='processing',lease_token=$1,
         lease_until=now()+interval '60 seconds',attempts=j.attempts+1,
         progress_pct=0,started_at=COALESCE(j.started_at,now())
       FROM candidate WHERE j.id=candidate.id
       RETURNING j.id,j.type,j.payload,j.lease_token,j.trace_parent`,
      [token, availableTypes, PROFILE_EXPORT_JOB_TYPE, MAX_CONCURRENT_PROFILE_EXPORTS]
    );
    await client.query('COMMIT');
    job = claimed.rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {
      discardClient = true;
    });
    throw error;
  } finally {
    client.release(discardClient);
  }
  if (!job) return false;

  const span = tracer?.startSpan(
    'async.job.process',
    { kind: SpanKind.CONSUMER },
    extractTraceparent(job.trace_parent)
  );
  const process = () => processAsyncJob(pool, registry, job, token, span);
  if (span) await operatorLogTrace.run(span.spanContext(), process).finally(() => span.end());
  else await process();
  return true;
}

async function processAsyncJob(
  pool: Pick<Pool, 'query'>,
  registry: JobHandlerRegistry,
  job: LeasedJob,
  token: string,
  span: ReturnType<Tracer['startSpan']> | undefined
): Promise<void> {
  let leaseLost = false;
  const renew = async () => {
    const result = await pool.query(
      `UPDATE async_jobs SET lease_until=now()+interval '60 seconds'
         WHERE id=$1 AND status='processing' AND lease_token=$2
           AND lease_until>clock_timestamp()`,
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
             WHERE id=$1 AND status='processing' AND lease_token=$2
               AND lease_until>clock_timestamp()`,
          [job.id, token, percentage]
        );
        if (result.rowCount !== 1) throw new Error('Async job lease lost');
      },
    });
    const resultUrl = output?.resultUrl ?? null;
    if (resultUrl !== null && relativeLinkRoute({ link_route: resultUrl }) === null)
      throw new Error('Invalid job result URL');
    if (leaseLost) throw new Error('Async job lease lost');
    await pool.query(
      `UPDATE async_jobs SET status='completed',progress_pct=100,result_url=$3,
         error_message=NULL,lease_token=NULL,lease_until=NULL,completed_at=now()
         WHERE id=$1 AND status='processing' AND lease_token=$2
           AND lease_until>clock_timestamp()`,
      [job.id, token, resultUrl]
    );
  } catch {
    span?.setStatus({ code: SpanStatusCode.ERROR });
    // Never store handler exceptions, which may contain credentials or customer data.
    await pool.query(
      `UPDATE async_jobs SET status='failed',error_message='JOB_FAILED',
         lease_token=NULL,lease_until=NULL,completed_at=now()
         WHERE id=$1 AND status='processing' AND lease_token=$2
           AND lease_until>clock_timestamp()`,
      [job.id, token]
    );
  } finally {
    clearInterval(heartbeat);
  }
}
