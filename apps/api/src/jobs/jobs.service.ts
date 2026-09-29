import { Injectable, NotFoundException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { v7 as uuidv7 } from 'uuid';

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
  async submit(type: string, payload: unknown, createdBy: string): Promise<string> {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(type)) throw new Error('Invalid job type');
    const serialized = JSON.stringify(payload);
    if (!serialized || Buffer.byteLength(serialized) > 64 * 1024)
      throw new Error('Invalid job payload');
    const id = uuidv7();
    await getDbPool().query(
      `INSERT INTO async_jobs(id,type,payload,created_by) VALUES ($1,$2,$3::jsonb,$4)`,
      [id, type, serialized, createdBy]
    );
    return id;
  }

  async get(id: string, userId: string): Promise<JobStatus> {
    if (!validId.test(id)) throw new NotFoundException();
    const result = await getDbPool().query<JobStatus>(
      `SELECT ${publicFields} FROM async_jobs WHERE id=$1 AND created_by=$2`,
      [id, userId]
    );
    if (!result.rows[0]) throw new NotFoundException();
    return result.rows[0];
  }

  async retry(id: string, userId: string): Promise<JobStatus> {
    if (!validId.test(id)) throw new NotFoundException();
    const result = await getDbPool().query<JobStatus>(
      `UPDATE async_jobs SET status='queued',progress_pct=0,result_url=NULL,
          error_message=NULL,attempts=0,started_at=NULL,completed_at=NULL
       WHERE id=$1 AND created_by=$2 AND status='failed'
       RETURNING ${publicFields}`,
      [id, userId]
    );
    if (!result.rows[0]) throw new NotFoundException();
    return result.rows[0];
  }
}
