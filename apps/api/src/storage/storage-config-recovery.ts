import type { PoolClient } from 'pg';
import { z } from 'zod';
import { storageConfigFields } from '@barghsa/shared/storage';
import { activationPageSize } from '../admin/config-activation-history.js';

export const storageRecoverySettings = storageConfigFields.omit({ accessKeyId: true });
export type StorageRecoverySettings = z.infer<typeof storageRecoverySettings>;
const storedDraft = z.object({
  sourceVersion: z.number().int().min(1).max(2_147_483_647),
  sourceId: z.string().uuid(),
  config: storageRecoverySettings,
});
export type StorageRecoveryDraft = z.infer<typeof storedDraft> & {
  id: string;
  baseVersion: number;
};

export async function storageRevisions(
  client: PoolClient,
  beforeVersion: number,
  sourceId?: string
) {
  const { rows } = await client.query<{ id: string; version: string; config: unknown }>(
    `WITH revisions AS (
       SELECT id, data->'previousSettings' AS config,
         CASE WHEN jsonb_typeof(data->'previousVersion')='number'
           THEN (data->>'previousVersion')::numeric END AS revision
       FROM audit_log CROSS JOIN LATERAL (
         SELECT CASE WHEN metadata IS JSON OBJECT THEN metadata::jsonb ELSE '{}'::jsonb END AS data
       ) safe
       WHERE event='storage.config.updated' AND data ? 'previousSettings'
         AND ($2::text IS NULL OR id=$2)
     )
     SELECT id,revision::text AS version,config FROM revisions
     WHERE revision>0 AND revision<$1 AND revision=trunc(revision)
     ORDER BY revision DESC,id DESC LIMIT $3`,
    [beforeVersion, sourceId ?? null, sourceId ? 1 : activationPageSize + 1]
  );
  const page = rows.slice(0, activationPageSize);
  return {
    items: page.flatMap(({ id, version, config }) => {
      const parsed = storageRecoverySettings.safeParse(config);
      return parsed.success ? [{ id, version: Number(version), config: parsed.data }] : [];
    }),
    nextBeforeVersion: rows.length > activationPageSize ? Number(page.at(-1)!.version) : null,
  };
}

export async function currentStorageDraft(
  client: PoolClient,
  baseVersion: number
): Promise<StorageRecoveryDraft | null> {
  const { rows } = await client.query<{ id: string; data: unknown }>(
    `SELECT id,data FROM audit_log CROSS JOIN LATERAL (
       SELECT CASE WHEN metadata IS JSON OBJECT THEN metadata::jsonb ELSE '{}'::jsonb END AS data
     ) safe
     WHERE event='storage.config.rollback_draft' AND data->>'baseVersion'=$1::text
     ORDER BY created_at DESC,id DESC LIMIT 1`,
    [baseVersion]
  );
  const row = rows[0];
  if (!row) return null;
  const parsed = storedDraft.safeParse(row.data);
  return parsed.success && parsed.data.sourceVersion < baseVersion
    ? { id: row.id, baseVersion, ...parsed.data }
    : null;
}
