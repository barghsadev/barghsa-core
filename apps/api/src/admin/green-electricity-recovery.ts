import {
  GREEN_ELECTRICITY_CONFIG_KEY,
  toGreenElectricityConfig,
  validateGreenElectricityConfig,
} from '@barghsa/shared/finance';
import type { PoolClient } from 'pg';
import { z } from 'zod';

const version = z.number().int().min(1).max(2_147_483_647);
export const greenRecoveryHistoryQuery = z.strictObject({
  beforeVersion: z
    .string()
    .regex(/^[1-9]\d{0,9}$/)
    .transform(Number)
    .pipe(version)
    .optional(),
});
export const greenRecoveryStageBody = z.strictObject({
  sourceId: z.string().uuid(),
  expectedVersion: version,
});
export const greenRecoveryActivateBody = z.strictObject({
  draftId: z.string().uuid(),
  expectedVersion: version,
});

export const GREEN_RECOVERY_EVENT = 'green_electricity.rollback_draft';
export const GREEN_HISTORY_PAGE_SIZE = 20;
type QueryClient = Pick<PoolClient, 'query'>;

export async function readGreenRuleVersion(client: QueryClient) {
  const result = await client.query<{ version: number }>(
    'SELECT version FROM app_config WHERE key=$1',
    [GREEN_ELECTRICITY_CONFIG_KEY]
  );
  return result.rows[0]?.version ?? 0;
}

export async function readGreenRuleHistory(
  client: QueryClient,
  beforeVersion: number,
  sourceId?: string
) {
  const { rows } = await client.query<{ id: string; version: string; config: unknown }>(
    `WITH events AS (
       SELECT id, CASE WHEN metadata IS JSON OBJECT THEN metadata::jsonb ELSE '{}'::jsonb END AS data
       FROM audit_log WHERE event='config_change' AND ($3::text IS NULL OR id=$3)
     ), revisions AS (
       SELECT id,data->'newValue' AS config,
         CASE WHEN jsonb_typeof(data->'version')='number' THEN (data->>'version')::numeric END AS version
       FROM events WHERE data->>'key'=$1
     )
     SELECT id,version::text,config FROM revisions WHERE version>0 AND version<$2
     ORDER BY revisions.version DESC,id DESC LIMIT $4`,
    [
      GREEN_ELECTRICITY_CONFIG_KEY,
      beforeVersion,
      sourceId ?? null,
      sourceId ? 1 : GREEN_HISTORY_PAGE_SIZE + 1,
    ]
  );
  return rows.flatMap((row) => {
    const parsed = version.safeParse(Number(row.version));
    return parsed.success && validateGreenElectricityConfig(row.config).ok
      ? [{ id: row.id, version: parsed.data, config: toGreenElectricityConfig(row.config) }]
      : [];
  });
}

export async function readGreenRuleDraft(client: QueryClient, baseVersion: number) {
  const { rows } = await client.query<{ id: string; draft: unknown }>(
    `WITH drafts AS (
       SELECT id,created_at,CASE WHEN metadata IS JSON OBJECT THEN metadata::jsonb ELSE '{}'::jsonb END AS draft
       FROM audit_log WHERE event=$1
     )
     SELECT id,draft FROM drafts WHERE draft->>'baseVersion'=$2::text AND draft->>'key'=$3
     ORDER BY created_at DESC,id DESC LIMIT 1`,
    [GREEN_RECOVERY_EVENT, baseVersion, GREEN_ELECTRICITY_CONFIG_KEY]
  );
  const row = rows[0];
  if (!row) return null;
  const draft = z
    .object({ sourceId: z.string().uuid(), sourceVersion: version, config: z.unknown() })
    .safeParse(row.draft);
  if (!draft.success || !validateGreenElectricityConfig(draft.data.config).ok) return null;
  return {
    id: row.id,
    baseVersion,
    sourceId: draft.data.sourceId,
    sourceVersion: draft.data.sourceVersion,
    config: toGreenElectricityConfig(draft.data.config),
  };
}
