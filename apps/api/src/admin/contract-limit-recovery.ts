import { z } from 'zod';
import type { PoolClient } from 'pg';
import {
  CONTRACT_ELECTRICITY_LIMITS_CONFIG_KEY,
  toContractElectricityLimits,
  validateContractElectricityLimits,
} from '@barghsa/shared/admin';
import { activationPageSize } from './config-activation-history.js';

const version = z.number().int().min(1).max(2_147_483_647);
export const stageContractLimitRecovery = z.strictObject({
  sourceId: z.string().uuid(),
  expectedVersion: version,
});
export const activateContractLimitRecovery = z.strictObject({
  draftId: z.string().uuid(),
  expectedVersion: version,
});
export const contractLimitDraftEvent = 'contract_electricity_limits.rollback_draft';

export async function contractLimitHistory(
  client: PoolClient,
  beforeVersion: number,
  sourceId?: string
) {
  const { rows } = await client.query<{ id: string; version: string; config: unknown }>(
    `WITH revisions AS (
       SELECT id, data->'newValue' AS config,
         CASE WHEN jsonb_typeof(data->'version')='number'
           THEN (data->>'version')::numeric END AS version
       FROM audit_log CROSS JOIN LATERAL (
         SELECT CASE WHEN metadata IS JSON OBJECT THEN metadata::jsonb ELSE '{}'::jsonb END AS data
       ) safe
       WHERE event='change_recorded' AND data->>'key'=$1
         AND data->>'entity'='contract_electricity_limits'
         AND data->>'action' IN ('updated','rollback_activated')
         AND ($3::text IS NULL OR id=$3)
     )
     SELECT id,version::text,config FROM revisions WHERE version>0 AND version<$2
       AND version=trunc(version)
     ORDER BY revisions.version DESC,id DESC LIMIT $4`,
    [
      CONTRACT_ELECTRICITY_LIMITS_CONFIG_KEY,
      beforeVersion,
      sourceId ?? null,
      sourceId ? 1 : activationPageSize + 1,
    ]
  );
  const page = rows.slice(0, activationPageSize);
  return {
    items: page.flatMap(({ id, version, config }) =>
      validateContractElectricityLimits(config).ok
        ? [{ id, version: Number(version), config: toContractElectricityLimits(config) }]
        : []
    ),
    nextBeforeVersion: rows.length > activationPageSize ? Number(page.at(-1)!.version) : null,
  };
}

const draftMetadata = z.object({
  sourceId: z.string().uuid(),
  sourceVersion: version,
  config: z.unknown(),
});

export async function readContractLimitDraft(client: PoolClient, baseVersion: number) {
  const { rows } = await client.query<{ id: string; metadata: unknown }>(
    `SELECT id,data AS metadata FROM audit_log CROSS JOIN LATERAL (
       SELECT CASE WHEN metadata IS JSON OBJECT THEN metadata::jsonb ELSE '{}'::jsonb END AS data
     ) safe
     WHERE event=$1 AND data->>'key'=$2 AND data->>'baseVersion'=$3::text
     ORDER BY created_at DESC,id DESC LIMIT 1`,
    [contractLimitDraftEvent, CONTRACT_ELECTRICITY_LIMITS_CONFIG_KEY, baseVersion]
  );
  const row = rows[0];
  if (!row) return null;
  const parsed = draftMetadata.safeParse(row.metadata);
  if (
    !parsed.success ||
    parsed.data.sourceVersion >= baseVersion ||
    !validateContractElectricityLimits(parsed.data.config).ok
  )
    return null;
  return {
    id: row.id,
    baseVersion,
    ...parsed.data,
    config: toContractElectricityLimits(parsed.data.config),
  };
}
