import type { PoolClient } from 'pg';
import { z } from 'zod';
import {
  ESCALATION_POLICY_CONFIG_KEY,
  SERVICE_RESPONSE_TARGETS_CONFIG_KEY,
  toEscalationPolicies,
  toServiceResponseTargets,
  validateEscalationPolicies,
  validateServiceResponseTargets,
  type EscalationPolicies,
  type ServiceResponseTargets,
} from '@barghsa/shared/admin';
import { activationPageSize } from './config-activation-history.js';
import { assertServiceSettingsFields } from './service-settings-fields.js';

export const serviceSettings = {
  targets: {
    key: SERVICE_RESPONSE_TARGETS_CONFIG_KEY,
    grant: 'admin:service-targets:edit',
    label: 'service response targets',
  },
  escalation: {
    key: ESCALATION_POLICY_CONFIG_KEY,
    grant: 'admin:service-escalation:edit',
    label: 'service escalation policy',
  },
} as const;
export type ServiceSetting = keyof typeof serviceSettings;
export type ServiceSettingValue = ServiceResponseTargets | EscalationPolicies;
export const serviceRecoveryDraftEvent = 'service_setting.rollback_draft';

const draftMetadata = z.object({
  sourceId: z.string().uuid(),
  sourceVersion: z.number().int().min(1).max(2_147_483_647),
  config: z.unknown(),
});
export type ServiceRecoveryDraft = {
  id: string;
  baseVersion: number;
  sourceId: string;
  sourceVersion: number;
  config: ServiceSettingValue;
};

function recoverableValue(setting: ServiceSetting, value: unknown): ServiceSettingValue | null {
  try {
    assertServiceSettingsFields(value, setting);
  } catch {
    return null;
  }
  if (setting === 'targets')
    return validateServiceResponseTargets(value).ok ? toServiceResponseTargets(value) : null;
  return validateEscalationPolicies(value).ok ? toEscalationPolicies(value) : null;
}

export async function serviceSettingRow(client: PoolClient, setting: ServiceSetting, lock = false) {
  const { rows } = await client.query<{ value: unknown; version: number }>(
    lock
      ? 'SELECT value, version FROM app_config WHERE key = $1 FOR UPDATE'
      : 'SELECT value, version FROM app_config WHERE key = $1',
    [serviceSettings[setting].key]
  );
  return rows[0];
}

export async function serviceSettingHistory(
  client: PoolClient,
  setting: ServiceSetting,
  beforeVersion: number,
  sourceId?: string
) {
  const { rows } = await client.query<{ id: string; version: number; value: unknown }>(
    `WITH revisions AS (
       SELECT id, data->'newValue' AS value,
         CASE WHEN jsonb_typeof(data->'version')='number' THEN (data->>'version')::numeric END AS version
       FROM audit_log CROSS JOIN LATERAL (
         SELECT CASE WHEN metadata IS JSON OBJECT THEN metadata::jsonb ELSE '{}'::jsonb END AS data
       ) safe
       WHERE event='config_change' AND data->>'key'=$1 AND data ? 'newValue'
         AND ($3::text IS NULL OR id=$3)
     )
     SELECT id, version::int, value FROM revisions
     WHERE version>0 AND version<$2 AND version=trunc(version)
     ORDER BY revisions.version DESC, id DESC LIMIT $4`,
    [
      serviceSettings[setting].key,
      beforeVersion,
      sourceId ?? null,
      sourceId ? 1 : activationPageSize + 1,
    ]
  );
  const page = rows.slice(0, activationPageSize);
  return {
    items: page.flatMap(({ id, version, value }) => {
      const config = recoverableValue(setting, value);
      return config ? [{ id, version, config }] : [];
    }),
    nextBeforeVersion: rows.length > activationPageSize ? page.at(-1)!.version : null,
  };
}

export async function serviceSettingDraft(
  client: PoolClient,
  setting: ServiceSetting,
  baseVersion: number
): Promise<ServiceRecoveryDraft | null> {
  const { rows } = await client.query<{ id: string; data: unknown }>(
    `SELECT id,data FROM audit_log CROSS JOIN LATERAL (
       SELECT CASE WHEN metadata IS JSON OBJECT THEN metadata::jsonb ELSE '{}'::jsonb END AS data
     ) safe
     WHERE event=$1 AND data->>'key'=$2 AND data->>'baseVersion'=$3::text
     ORDER BY created_at DESC,id DESC LIMIT 1`,
    [serviceRecoveryDraftEvent, serviceSettings[setting].key, baseVersion]
  );
  const row = rows[0];
  if (!row) return null;
  const parsed = draftMetadata.safeParse(row.data);
  if (!parsed.success || parsed.data.sourceVersion >= baseVersion) return null;
  const config = recoverableValue(setting, parsed.data.config);
  return config ? { id: row.id, baseVersion, ...parsed.data, config } : null;
}
