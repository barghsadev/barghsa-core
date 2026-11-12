import type { ValidatedSession } from '../session/session.service.js';
import { requireCurrentSession, requireSessionStepUp } from '../session/session-step-up.js';
import { requireStaffMutationPermission } from './staff-mutation-permission.js';
import { ForbiddenException, Injectable, Logger, HttpException } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { getDbPool } from '@barghsa/db';
import type { PoolClient } from 'pg';
import { ErrorCodes } from '@barghsa/shared/errors';
import {
  isBackgroundJobStatus,
  isBackgroundJobType,
  backgroundJobLabel,
  type BackgroundJobStatus,
  type BackgroundJobType,
} from '@barghsa/shared/admin';

/** A background job as returned by the admin API (S-09.09, T-09.09.02). */
export interface FailedJobDto {
  id: string;
  jobType: BackgroundJobType | string;
  jobLabel: string;
  status: BackgroundJobStatus;
  error: string | null;
  errorCategory: string;
  attempts: number;
  maxAttempts: number;
  payload: Record<string, unknown> | null;
  firstFailedAt: string;
  lastRunAt: string;
  nextRunAt: string | null;
  resolvedById: string | null;
  resolvedByUsername: string | null;
  resolvedAt: string | null;
}

/** Options for the failed-jobs list view. */
export interface ListFailedJobsOptions {
  status?: BackgroundJobStatus;
  jobType?: BackgroundJobType | string;
  limit?: number;
  offset?: number;
}

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;
const MAX_BULK_RETRY_IDS = 200;
type JobActor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;

async function assertStaffContext(client: PoolClient) {
  const result = await client.query(
    "SELECT current_setting('barghsa.actor_context', true) AS context"
  );
  if (result.rows[0]?.context !== 'staff') throw new ForbiddenException();
}

/**
 * Failed-jobs dashboard service (S-09.09, T-09.09.02).
 *
 * Admin/staff surface for background-job failures recorded by the worker
 * into `background_jobs`:
 *
 * - {@link listFailedJobs} — the triage view, optionally filtered by status
 *   and job type, most-recently-failed first.
 * - {@link retryFailedJob} — `failed`/`dead_letter` → `retrying` (fresh
 *   attempt budget; the worker re-runs on its next loop).
 * - {@link retryFailedJobsBulk} — batch form of the above.
 * - {@link resolveFailedJob} — `failed`/`retrying`/`dead_letter` → `resolved`
 *   (terminal, manual dismissal).
 *
 * Every admin state change writes an `audit_log` row (`job_retry_requested`
 * / `job_resolved`) in the same transaction as the change. The worker itself
 * auto-resolves a job when it recovers (a success path with no admin actor,
 * so no audit row).
 */
@Injectable()
export class FailedJobsService {
  private readonly logger = new Logger(FailedJobsService.name);

  async getFailedJob(id: string, actor: JobActor): Promise<FailedJobDto> {
    return this.readForStaff(actor, async (client) => {
      const result = await client.query(
        `SELECT bj.*, resolver.username AS resolved_by_username
         FROM background_jobs bj
         LEFT JOIN users resolver ON resolver.user_id = bj.resolved_by_id
        WHERE bj.id = $1`,
        [id]
      );
      if (!result.rows[0])
        throw new HttpException({ error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
      return toFailedJobDto(result.rows[0]);
    });
  }

  /**
   * List background-job failures, optionally filtered by status/jobType,
   * most-recently-failed first.
   *
   * @throws 400 when an invalid status or jobType filter is supplied.
   */
  async listFailedJobs(options: ListFailedJobsOptions, actor: JobActor): Promise<FailedJobDto[]> {
    const limit = sanitizeLimit(options.limit);
    const offset = sanitizeOffset(options.offset);
    const status = options.status ?? null;
    const jobType = options.jobType ?? null;

    if (status !== null && !isBackgroundJobStatus(status)) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: 'status must be one of failed, retrying, dead_letter, resolved',
        },
        400
      );
    }

    if (jobType !== null && !isBackgroundJobType(jobType)) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: 'jobType is not a known background job type',
        },
        400
      );
    }

    return this.readForStaff(actor, async (client) => {
      const result = await client.query(
        `SELECT bj.*, resolver.username AS resolved_by_username
         FROM background_jobs bj
         LEFT JOIN users resolver ON resolver.user_id = bj.resolved_by_id
        WHERE ($1::text IS NULL OR bj.status = $1)
          AND ($2::text IS NULL OR bj.job_type = $2)
        ORDER BY bj.first_failed_at DESC, bj.id DESC
        LIMIT $3 OFFSET $4`,
        [status, jobType, limit, offset]
      );

      return result.rows.map(toFailedJobDto);
    });
  }

  private async readForStaff<T>(actor: JobActor, read: (client: PoolClient) => Promise<T>) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actor.userId, 'admin:jobs:view');
      await requireCurrentSession(client, actor);
      await assertStaffContext(client);
      const result = await read(client);
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Retry a single failed/dead-lettered job: reset its attempt budget and
   * mark it `retrying` so the worker re-attempts it on the next loop.
   *
   * @throws 404 when the job does not exist, 409 when it is already resolved.
   */
  async retryFailedJob(jobId: string, actor: JobActor, ip: string): Promise<FailedJobDto> {
    return (await this.transition([jobId], actor, ip, 'retrying', false))[0]!;
  }

  /**
   * Retry a batch of failed/dead-lettered jobs. Rows that are not in a
   * retryable state are skipped (not an error); a job that does not exist is
   * skipped too. Returns the jobs that were successfully moved to retrying.
   */
  async retryFailedJobsBulk(ids: string[], actor: JobActor, ip: string): Promise<FailedJobDto[]> {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: 'ids must be a non-empty array of job ids',
        },
        400
      );
    }
    if (ids.length > MAX_BULK_RETRY_IDS) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: `ids must not exceed ${MAX_BULK_RETRY_IDS} entries`,
        },
        400
      );
    }

    return this.transition([...new Set(ids)].sort(), actor, ip, 'retrying', true);
  }

  /**
   * Resolve a failed/retrying/dead-lettered job, making it terminal. A
   * resolved job is excluded from the active partial index, so a future
   * worker failure starts a fresh row.
   *
   * @throws 404 when the job does not exist, 409 when it is already resolved.
   */
  async resolveFailedJob(jobId: string, actor: JobActor, ip: string): Promise<FailedJobDto> {
    return (await this.transition([jobId], actor, ip, 'resolved', false))[0]!;
  }

  private async transition(
    ids: string[],
    actor: JobActor,
    ip: string,
    toStatus: 'retrying' | 'resolved',
    skipInvalid: boolean
  ): Promise<FailedJobDto[]> {
    const actorUserId = actor.userId;
    const client = await getDbPool().connect();
    const now = new Date();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actorUserId, 'admin:jobs:retry');
      await requireSessionStepUp(client, actor);
      await assertStaffContext(client);
      const found = await client.query(
        `SELECT id,job_type,status FROM background_jobs WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
        [ids]
      );
      if (!skipInvalid && !found.rows.length)
        throw new HttpException(
          { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code },
          404
        );
      const results: FailedJobDto[] = [];
      const allowed =
        toStatus === 'retrying' ? ['failed', 'dead_letter'] : ['failed', 'retrying', 'dead_letter'];
      for (const row of found.rows) {
        if (!allowed.includes(row.status)) {
          if (skipInvalid) continue;
          throw new HttpException({ statusCode: 409, error: ErrorCodes.CONFLICT_STATE.code }, 409);
        }
        if (toStatus === 'retrying') {
          await client.query(
            `UPDATE background_jobs SET status='retrying',attempts=1,next_run_at=$2,
            resolved_by_id=NULL,resolved_at=NULL,updated_at=$2 WHERE id=$1`,
            [row.id, now]
          );
        } else {
          await client.query(
            `UPDATE background_jobs SET status='resolved',resolved_by_id=$2,
            resolved_at=$3,next_run_at=NULL,updated_at=$3 WHERE id=$1`,
            [row.id, actorUserId, now]
          );
        }
        await client.query(
          `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip,created_at)
          VALUES($1,$2,$3,$4::jsonb,$5,$6,$7)`,
          [
            uuidv7(),
            actorUserId,
            toStatus === 'retrying' ? 'job_retry_requested' : 'job_resolved',
            JSON.stringify({
              backgroundJobId: row.id,
              jobType: row.job_type,
              fromStatus: row.status,
              toStatus,
            }),
            uuidv7(),
            ip,
            now,
          ]
        );
        const updated = await client.query(
          `SELECT bj.*,resolver.username AS resolved_by_username
          FROM background_jobs bj LEFT JOIN users resolver ON resolver.user_id=bj.resolved_by_id WHERE bj.id=$1`,
          [row.id]
        );
        results.push(toFailedJobDto(updated.rows[0]!));
      }
      await requireSessionStepUp(client, actor);
      await client.query('COMMIT');
      return results;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error instanceof HttpException) throw error;
      this.logger.error('Failed to persist background-job transition');
      throw new HttpException(
        {
          statusCode: 500,
          error: ErrorCodes.INTERNAL_SERVER.code,
          message: 'Failed to transition background job',
        },
        500
      );
    } finally {
      client.release();
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

// Worker producers record aggregate counts for triage. Retained payloads may
// also contain provider input that does not belong in a staff job receipt.
const jobCounterKeys = new Set([
  'aborted',
  'cancelled',
  'clean',
  'completed',
  'deleted',
  'delivered',
  'destroyed',
  'errors',
  'expirationScheduled',
  'failed',
  'infected',
  'marked',
  'planned',
  'rejected',
  'reported',
  'retrying',
  'scanned',
  'scheduled',
  'sent',
  'walletAlertErrors',
]);

function jobPayloadSummary(value: unknown): FailedJobDto['payload'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.fromEntries(
    Object.entries(value).filter(([key, entry]) =>
      key === 'busy'
        ? typeof entry === 'boolean'
        : jobCounterKeys.has(key) &&
          typeof entry === 'number' &&
          Number.isSafeInteger(entry) &&
          entry >= 0
    )
  );
}

/** Map a raw pg row to the API DTO. */
export function toFailedJobDto(row: Record<string, unknown>): FailedJobDto {
  const toIso = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    const d = v instanceof Date ? v : new Date(String(v));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };

  const jobType = String(row.job_type);
  return {
    id: String(row.id),
    jobType,
    jobLabel: backgroundJobLabel(jobType),
    status: row.status as BackgroundJobStatus,
    error: row.error === null || row.error === undefined ? null : String(row.error),
    errorCategory: String(row.error_category),
    attempts: Number(row.attempts) || 0,
    maxAttempts: Number(row.max_attempts) || 0,
    payload: jobPayloadSummary(row.payload),
    firstFailedAt: toIso(row.first_failed_at) ?? toIso(row.created_at) ?? '',
    lastRunAt: toIso(row.last_run_at) ?? '',
    nextRunAt: toIso(row.next_run_at),
    resolvedById:
      row.resolved_by_id === null || row.resolved_by_id === undefined
        ? null
        : String(row.resolved_by_id),
    resolvedByUsername:
      row.resolved_by_username === null || row.resolved_by_username === undefined
        ? null
        : String(row.resolved_by_username),
    resolvedAt: toIso(row.resolved_at),
  };
}

/** Clamp a list limit to the documented bounds. */
export function sanitizeLimit(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_LIST_LIMIT;
  if (!Number.isInteger(raw) || raw < 1) return DEFAULT_LIST_LIMIT;
  return Math.min(raw, MAX_LIST_LIMIT);
}

/** Clamp a list offset to a non-negative integer. */
export function sanitizeOffset(raw: number | undefined): number {
  if (raw === undefined || !Number.isInteger(raw) || raw < 0) return 0;
  return raw;
}
