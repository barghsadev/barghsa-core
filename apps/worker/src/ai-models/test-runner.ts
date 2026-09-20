import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  AiModelTester,
  AiModelSecrets,
  type AiModelTestInput,
  type AiModelTestResult,
} from '@barghsa/shared/ai-models';
import { resolveStaffPermissions } from '@barghsa/shared/admin';
import { logDelivery } from '../delivery-log.js';

interface Claim {
  id: string;
  correlation_id: string | null;
  model_id: string | null;
  model_revision: string;
  actor_user_id: string;
}
/** Claim one short-lived request. Provider I/O never holds a pool connection. */
export async function runAiModelTest(
  pool: Pool,
  tester: Pick<AiModelTester, 'test'> = new AiModelTester(),
  secrets = new AiModelSecrets()
): Promise<'idle' | 'completed' | 'failed' | 'stale'> {
  await pool.query(`UPDATE ai_model_test_jobs SET status='failed', error_code='AI_MODEL_TEST_EXPIRED', lease_token=NULL, lease_until=NULL, updated_at=NOW()
    WHERE status IN ('pending','leased') AND (deadline_at<=NOW() OR (status='leased' AND lease_until<=NOW() AND attempts>=2))`);
  // Terminal previews are ephemeral, not a permanent transcript store.
  await pool.query(
    `DELETE FROM ai_model_test_jobs WHERE status IN ('completed','failed','cancelled') AND updated_at<NOW()-INTERVAL '1 day'`
  );
  const token = randomUUID();
  const claimed = await pool.query<Claim>(
    `WITH candidate AS (
    SELECT id FROM ai_model_test_jobs WHERE deadline_at>NOW() AND attempts<2
      AND (status='pending' OR (status='leased' AND lease_until<=NOW()))
    ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE ai_model_test_jobs j SET status='leased', attempts=attempts+1,
    lease_token=$1, lease_until=NOW()+INTERVAL '70 seconds', updated_at=NOW()
    FROM candidate c WHERE j.id=c.id RETURNING j.id,j.model_id,j.model_revision,j.actor_user_id,j.correlation_id`,
    [token]
  );
  const job = claimed.rows[0];
  if (!job) return 'idle';
  const finish = async (result: AiModelTestResult | null, error: string | null) => {
    const saved = await pool.query(
      `UPDATE ai_model_test_jobs SET status=$3, result=$4::jsonb,error_code=$5,
      lease_token=NULL,lease_until=NULL,updated_at=NOW() WHERE id=$1 AND lease_token=$2 AND status='leased' AND lease_until>NOW() AND deadline_at>NOW()`,
      [
        job.id,
        token,
        result ? 'completed' : 'failed',
        result ? JSON.stringify(result) : null,
        error,
      ]
    );
    const status = saved.rowCount === 1 ? (result ? 'completed' : 'failed') : 'stale';
    logDelivery('ai.model_test', job.id, job.correlation_id, status);
    return status;
  };
  const users = await pool.query<{
    is_admin: boolean;
    disabled_at: Date | null;
    activation_token: string | null;
    permissions: unknown;
  }>(
    `SELECT u.is_admin,u.disabled_at,u.activation_token,COALESCE(jsonb_agg(r.permissions) FILTER (WHERE r.role_id IS NOT NULL),'[]'::jsonb) AS permissions
     FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.user_id LEFT JOIN staff_roles r ON r.role_id=ur.role_id
     WHERE u.user_id=$1 GROUP BY u.user_id`,
    [job.actor_user_id]
  );
  const actor = users.rows[0];
  const permissions = resolveStaffPermissions(actor?.permissions);
  if (
    !actor ||
    actor.disabled_at ||
    actor.activation_token ||
    (!actor.is_admin && !permissions.includes('*') && !permissions.includes('admin:ai:models'))
  ) {
    return finish(null, 'AUTHZ:FORBIDDEN');
  }
  const models = await pool.query<{
    revision: string;
    provider_type: AiModelTestInput['providerType'];
    base_url: string;
    model_name: string;
    api_token: string | null;
  }>(
    'SELECT xmin::text AS revision,provider_type,base_url,model_name,api_token FROM ai_models WHERE id=$1',
    [job.model_id]
  );
  const model = models.rows[0];
  if (!model) return finish(null, 'AI_MODEL_NOT_FOUND');
  if (model.revision !== job.model_revision) return finish(null, 'AI_MODEL_CHANGED');
  let apiToken: string | null;
  try {
    apiToken = model.api_token === null ? null : secrets.decryptToken(model.api_token);
  } catch {
    return finish(
      {
        ok: false,
        error: 'Stored API token could not be decrypted (check AI_MODEL_ENCRYPTION_KEY)',
        latencyMs: 0,
      },
      null
    );
  }
  const lease = await pool.query<{ remaining_ms: number }>(
    `SELECT EXTRACT(EPOCH FROM (LEAST(deadline_at,lease_until)-NOW()))*1000 AS remaining_ms
    FROM ai_model_test_jobs WHERE id=$1 AND lease_token=$2 AND status='leased' AND lease_until>NOW() AND deadline_at>NOW()`,
    [job.id, token]
  );
  if (!lease.rows[0]) return 'stale';
  const result = await tester.test(
    {
      providerType: model.provider_type,
      baseUrl: model.base_url,
      modelName: model.model_name,
      apiToken,
    },
    Number(lease.rows[0].remaining_ms)
  );
  return finish(result, null);
}
