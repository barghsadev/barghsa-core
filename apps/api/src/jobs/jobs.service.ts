import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { v7 as uuidv7 } from 'uuid';
import { ErrorCodes } from '@barghsa/shared/errors';
import type { OperatingContext, ValidatedSession } from '../session/session.service.js';
import { requireCurrentSession } from '../session/session-step-up.js';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';

export interface JobStatus {
  id: string;
  type: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress_pct: number;
  result_url: string | null;
  error_message: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

const publicFields = `id,type,status,progress_pct,result_url,error_message,
  created_at,started_at,completed_at`;
const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Submit work from an authorized product service; payload is never returned to the browser. */
@Injectable()
export class JobService {
  async submit(
    type: string,
    payload: unknown,
    createdBy: string,
    operatingContext: OperatingContext = 'customer'
  ): Promise<string> {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(type)) throw new Error('Invalid job type');
    const serialized = JSON.stringify(payload);
    if (!serialized || Buffer.byteLength(serialized) > 64 * 1024)
      throw new Error('Invalid job payload');
    const id = uuidv7();
    await getDbPool().query(
      `INSERT INTO async_jobs(id,type,payload,created_by,operating_context)
       VALUES ($1,$2,$3::jsonb,$4,$5)`,
      [id, type, serialized, createdBy, operatingContext]
    );
    return id;
  }

  async get(id: string, userId: string, operatingContext: OperatingContext): Promise<JobStatus> {
    if (!validId.test(id)) throw new NotFoundException();
    const result = await getDbPool().query<JobStatus>(
      `SELECT ${publicFields} FROM async_jobs
       WHERE id=$1 AND created_by=$2 AND operating_context=$3`,
      [id, userId, operatingContext]
    );
    if (!result.rows[0]) throw new NotFoundException();
    return result.rows[0];
  }

  async retry(
    id: string,
    actor: Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken' | 'operatingContext'>
  ): Promise<JobStatus> {
    if (!validId.test(id)) throw new NotFoundException();
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const users = await client.query(
        'SELECT disabled_at,activation_token FROM users WHERE user_id=$1 FOR UPDATE',
        [actor.userId]
      );
      const user = users.rows[0];
      if (!user || user.disabled_at || user.activation_token)
        throw new HttpException({ error: ErrorCodes.AUTH_UNAUTHENTICATED.code }, 401);
      await requireCurrentSession(client, actor);
      const result = await client.query<JobStatus>(
        `UPDATE async_jobs SET status='queued',progress_pct=0,result_url=NULL,
            error_message=NULL,attempts=0,started_at=NULL,completed_at=NULL
         WHERE id=$1 AND created_by=$2 AND operating_context=$3 AND status='failed'
         RETURNING ${publicFields}`,
        [id, actor.userId, actor.operatingContext]
      );
      if (!result.rows[0]) throw new NotFoundException();
      await requireCurrentSession(client, actor);
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata,operating_context,correlation_id)
         VALUES($1,$2,'async_job_retried',$3,$4,$5)`,
        [
          uuidv7(),
          actor.userId,
          JSON.stringify({ jobId: id, type: result.rows[0].type, from: 'failed', to: 'queued' }),
          actor.operatingContext,
          correlationIdStorage.getStore() ?? null,
        ]
      );
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
