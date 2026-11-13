import { z } from 'zod';
import type { PoolClient } from 'pg';
import { WIZARD_DRAFT_TTL_KEY } from '../common/wizard-draft-retention.js';
import { activationPageSize } from './config-activation-history.js';

export const templateSettingKey = 'electricity.contract_template_version_id';
export const electricitySettingRoute = z.enum([
  'wizard-draft-ttl',
  'electricity-contract-template',
]);
export type ElectricitySettingRoute = z.infer<typeof electricitySettingRoute>;
export const electricitySettingKeys = {
  'wizard-draft-ttl': WIZARD_DRAFT_TTL_KEY,
  'electricity-contract-template': templateSettingKey,
} as const;
export const electricitySettingLock = {
  'wizard-draft-ttl': 'electricity-order-draft-ttl',
  'electricity-contract-template': 'electricity-contract-template',
} as const;
const version = z.number().int().min(1).max(2_147_483_647);
const days = z.number().int().min(1).max(365);
const templateId = z.string().uuid().nullable();
const retention = z.strictObject({ days });
const template = z.strictObject({ versionId: templateId });
export type ElectricityRecoveryConfig = z.infer<typeof retention> | z.infer<typeof template>;
export const electricityRecoveryDraftEvent = 'electricity_setting.rollback_draft';
export const stageElectricitySetting = z.strictObject({
  sourceId: z.string().uuid(),
  expectedVersion: version,
});
export const activateElectricitySetting = z.strictObject({
  draftId: z.string().uuid(),
  expectedVersion: version,
});

export async function electricitySettingHistory(
  client: PoolClient,
  setting: ElectricitySettingRoute,
  beforeVersion: number,
  sourceId?: string
) {
  const { rows } = await client.query<{ id: string; version: string; value: unknown }>(
    `WITH revisions AS (
       SELECT id,data->'newValue' AS value,
         CASE WHEN jsonb_typeof(data->'version')='number'
           THEN (data->>'version')::numeric END AS version
       FROM audit_log CROSS JOIN LATERAL (
         SELECT CASE WHEN metadata IS JSON OBJECT THEN metadata::jsonb ELSE '{}'::jsonb END AS data
       ) safe
       WHERE event='config_change' AND data->>'key'=$1 AND data ? 'newValue'
         AND ($3::text IS NULL OR id=$3)
     )
     SELECT id,version::text,value FROM revisions WHERE version>0 AND version<$2
       AND version=trunc(version)
     ORDER BY revisions.version DESC,id DESC LIMIT $4`,
    [
      electricitySettingKeys[setting],
      beforeVersion,
      sourceId ?? null,
      sourceId ? 1 : activationPageSize + 1,
    ]
  );
  const page = rows.slice(0, activationPageSize);
  return {
    items: page.flatMap(({ id, version, value }) => {
      const parsed =
        setting === 'wizard-draft-ttl'
          ? retention.safeParse({ days: value })
          : template.safeParse({ versionId: value });
      return parsed.success ? [{ id, version: Number(version), config: parsed.data }] : [];
    }),
    nextBeforeVersion: rows.length > activationPageSize ? Number(page.at(-1)!.version) : null,
  };
}

const draftMetadata = z.object({
  sourceId: z.string().uuid(),
  sourceVersion: version,
  config: z.unknown(),
});

export async function readElectricitySettingDraft(
  client: PoolClient,
  setting: ElectricitySettingRoute,
  baseVersion: number
) {
  const { rows } = await client.query<{ id: string; data: unknown }>(
    `SELECT id,data FROM audit_log CROSS JOIN LATERAL (
       SELECT CASE WHEN metadata IS JSON OBJECT THEN metadata::jsonb ELSE '{}'::jsonb END AS data
     ) safe
     WHERE event=$1 AND data->>'key'=$2 AND data->>'baseVersion'=$3::text
     ORDER BY created_at DESC,id DESC LIMIT 1`,
    [electricityRecoveryDraftEvent, electricitySettingKeys[setting], baseVersion]
  );
  const row = rows[0];
  if (!row) return null;
  const parsed = draftMetadata.safeParse(row.data);
  if (!parsed.success || parsed.data.sourceVersion >= baseVersion) return null;
  const config = (setting === 'wizard-draft-ttl' ? retention : template).safeParse(
    parsed.data.config
  );
  if (!config.success) return null;
  return { id: row.id, baseVersion, ...parsed.data, config: config.data };
}
