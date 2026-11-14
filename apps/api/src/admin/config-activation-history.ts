import { getDbPool } from '@barghsa/db';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { ValidatedSession } from '../session/session.service.js';
import { requireCurrentSession } from '../session/session-step-up.js';
import { requireStaffMutationPermission } from './staff-mutation-permission.js';

export const activationPageSize = 20;
const revision = z.number().int().min(1).max(2_147_483_647);
export const stageRecoveryDraft = z.strictObject({
  sourceId: z.string().uuid(),
  expectedVersion: revision,
});
export const activateRecoveryDraft = z.strictObject({
  draftId: z.string().uuid(),
  expectedVersion: revision,
});
export const activationHistoryQuery = z.strictObject({
  beforeVersion: z
    .string()
    .regex(/^[1-9]\d{0,9}$/)
    .transform(Number)
    .pipe(z.number().int().max(2_147_483_647))
    .optional(),
});

export async function configActivations<T>(
  client: PoolClient,
  key: string,
  field: 'active' | 'mode' | 'policy',
  valid: (value: unknown) => value is T,
  options: { beforeVersion?: number | undefined; sourceId?: string } = {}
) {
  const { rows } = await client.query<{ id: string; version: string; value: unknown }>(
    `WITH revisions AS (
       SELECT id, data->'next'->$2::text AS value,
         CASE WHEN jsonb_typeof(data#>'{next,version}')='number'
           THEN (data#>>'{next,version}')::numeric END AS version
       FROM audit_log CROSS JOIN LATERAL (
         SELECT CASE WHEN metadata IS JSON OBJECT THEN metadata::jsonb ELSE '{}'::jsonb END AS data
       ) safe
       WHERE event='config_change' AND data->>'key'=$1
         AND (data->>'action'='activate' OR ($2='policy' AND NOT (data ? 'action')))
         AND ($3::text IS NULL OR id=$3)
     )
     SELECT id,version::text,value FROM revisions WHERE version>0
       AND version<=2147483647 AND version=trunc(version)
       AND ($4::integer IS NULL OR version<$4)
     ORDER BY revisions.version DESC,id DESC LIMIT $5`,
    [
      key,
      field,
      options.sourceId ?? null,
      options.beforeVersion ?? null,
      options.sourceId ? 1 : activationPageSize + 1,
    ]
  );
  const page = rows.slice(0, activationPageSize);
  return {
    items: page.flatMap(({ id, version, value }) =>
      valid(value) ? [{ id, version: Number(version), value }] : []
    ),
    nextBeforeVersion: rows.length > activationPageSize ? Number(page.at(-1)!.version) : null,
  };
}

export async function readConfigActivationHistory<T>(
  actor: Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>,
  key: string,
  field: 'active' | 'mode',
  valid: (value: unknown) => value is T,
  beforeVersion?: number
) {
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    await requireStaffMutationPermission(client, actor.userId, 'admin:config:read');
    await requireCurrentSession(client, actor);
    const history = await configActivations(client, key, field, valid, { beforeVersion });
    await requireCurrentSession(client, actor);
    await client.query('COMMIT');
    return history;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
