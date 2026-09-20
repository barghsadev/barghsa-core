import { Injectable, HttpException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import type { PoolClient } from 'pg';
import { getDbPool } from '@barghsa/db';
import { z } from 'zod';
import type { AiModelTestResult } from '@barghsa/shared/ai-models';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';
const resultSchema = z
  .object({
    ok: z.boolean(),
    latencyMs: z.number().finite().nonnegative(),
    responsePreview: z.string().max(300).optional(),
    error: z.string().max(500).optional(),
  })
  .strict();
function waitMs() {
  const configured = Number(process.env.AI_MODEL_TEST_WAIT_MS ?? 75000);
  return Number.isFinite(configured) ? Math.min(90000, Math.max(1000, configured)) : 75000;
}
@Injectable()
export class AiModelTestQueueService {
  async enqueue(
    client: Pick<PoolClient, 'query'>,
    modelId: string,
    revision: string,
    actorUserId: string
  ): Promise<string> {
    const id = randomUUID();
    await client.query(
      `INSERT INTO ai_model_test_jobs(id,model_id,model_revision,actor_user_id,deadline_at,correlation_id)
      VALUES ($1,$2,$3,$4,NOW()+($5 * INTERVAL '1 millisecond'),$6)`,
      [id, modelId, revision, actorUserId, waitMs(), correlationIdStorage.getStore() ?? null]
    );
    return id;
  }
  /** Preserve the existing test-button response while a separate worker executes it. */
  async wait(id: string): Promise<AiModelTestResult> {
    const deadline = Date.now() + waitMs();
    try {
      while (Date.now() < deadline) {
        const read = await getDbPool().query<{
          status: string;
          result: unknown;
          error_code: string | null;
          expired: boolean;
        }>(
          'SELECT status,result,error_code,deadline_at<=NOW() AS expired FROM ai_model_test_jobs WHERE id=$1',
          [id]
        );
        const job = read.rows[0];
        if (!job) throw this.failure('AI_MODEL_TEST_UNAVAILABLE');
        if (job.status === 'completed') {
          const result = resultSchema.safeParse(job.result);
          if (!result.success) throw this.failure('AI_MODEL_TEST_UNAVAILABLE');
          return {
            ok: result.data.ok,
            latencyMs: result.data.latencyMs,
            ...(result.data.error === undefined ? {} : { error: result.data.error }),
            ...(result.data.responsePreview === undefined
              ? {}
              : { responsePreview: result.data.responsePreview }),
          };
        }
        if (job.status === 'failed' || job.status === 'cancelled')
          throw this.failure(job.error_code ?? 'AI_MODEL_TEST_UNAVAILABLE');
        if (job.expired) break;
        await pause(250);
      }
      throw this.failure('AI_MODEL_TEST_EXPIRED');
    } finally {
      await getDbPool().query(
        `UPDATE ai_model_test_jobs SET status='cancelled',lease_token=NULL,lease_until=NULL,updated_at=NOW()
        WHERE id=$1 AND status IN ('pending','leased')`,
        [id]
      );
    }
  }
  private failure(code: string) {
    const status =
      (
        {
          'AUTHZ:FORBIDDEN': 403,
          AI_MODEL_NOT_FOUND: 404,
          AI_MODEL_CHANGED: 409,
          AI_MODEL_TEST_EXPIRED: 504,
        } as Record<string, number>
      )[code] ?? 503;
    return new HttpException(
      {
        statusCode: status,
        error: status === 503 ? 'AI_MODEL_TEST_UNAVAILABLE' : code,
        message: 'The model test could not complete; check the worker and retry',
      },
      status
    );
  }
}
