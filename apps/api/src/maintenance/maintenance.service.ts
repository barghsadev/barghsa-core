import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { ErrorCodes } from '@barghsa/shared/errors';
import {
  isStandardMaintenanceNotice,
  standardMaintenanceNotice,
} from '@barghsa/i18n/maintenance-public';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';
import { requireSessionStepUp } from '../session/session-step-up.js';
import type { ValidatedSession } from '../session/session.service.js';

export const capabilities = [
  'electricity_checkout',
  'saving_orders',
  'solar_requests',
  'wallet_topup',
  'ai_chat',
] as const;
export type Capability = (typeof capabilities)[number];

const settingSchema = z
  .object({
    active: z.boolean(),
    reason: z
      .object({
        fa: z.string().trim().min(1).max(500),
        en: z.string().trim().min(1).max(500),
      })
      .strict()
      .nullable(),
    estimatedUntil: z.string().datetime({ offset: true }).nullable(),
    owner: z.string().trim().min(1).max(100).nullable(),
  })
  .strict();
const versionSchema = z.number().int().min(0).max(2147483647);
export const updateSchema = settingSchema
  .extend({
    expectedVersion: versionSchema,
    publishReason: z.boolean().optional(),
    rollbackDraftId: z.uuid().optional(),
  })
  .superRefine((value, context) => {
    if (!value.active) return;
    for (const field of ['reason', 'owner', 'estimatedUntil'] as const)
      if (
        value[field] === null ||
        (field === 'estimatedUntil' && Date.parse(value.estimatedUntil!) <= Date.now())
      )
        context.addIssue({
          code: 'custom',
          path: [field],
          message: 'Required maintenance field is invalid',
        });
  });
export const maintenanceRollbackSchema = z.strictObject({
  sourceId: z.uuid(),
  expectedVersion: versionSchema,
});
const snapshotSchema = settingSchema.extend({
  capability: z.enum(capabilities),
  version: versionSchema.min(1),
  updatedAt: z.iso.datetime(),
});
const rollbackDraftSchema = z.object({
  sourceId: z.uuid(),
  baseVersion: versionSchema,
  setting: snapshotSchema,
});
type StaffActor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;
type QueryClient = Pick<PoolClient, 'query'>;

export interface MaintenanceSetting extends z.infer<typeof settingSchema> {
  capability: Capability;
  version: number;
  updatedAt: string | null;
}

interface ConfigRow {
  key: string;
  value: unknown;
  version: number;
  updated_at: Date | string;
}

const keyFor = (capability: Capability) => `maintenance.${capability}`;
const rollbackEvent = 'maintenance.rollback_draft';
const historyPageSize = 20;

function settingFor(capability: Capability, row?: ConfigRow): MaintenanceSetting {
  if (!row)
    return {
      capability,
      active: false,
      reason: null,
      estimatedUntil: null,
      owner: null,
      version: 0,
      updatedAt: null,
    };
  const value = settingSchema.parse(row.value);
  return {
    capability,
    ...value,
    version: row.version,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function readHistory(
  client: QueryClient,
  key: string,
  beforeVersion: number,
  sourceId: string | null = null
) {
  const { rows } = await client.query<{ id: string; snapshot: unknown }>(
    `WITH changes AS (
       SELECT id, CASE WHEN metadata IS JSON OBJECT THEN metadata::jsonb ELSE '{}'::jsonb END AS event_data
       FROM audit_log WHERE event='config_change' AND ($3::text IS NULL OR id=$3)
     ), snapshots AS (
       SELECT id, event_data->'next' AS snapshot,
         CASE WHEN jsonb_typeof(event_data->'next'->'version')='number'
              THEN (event_data->'next'->>'version')::numeric END AS version
       FROM changes WHERE event_data->>'key'=$1
     )
     SELECT id,snapshot FROM snapshots WHERE version>0 AND version<$2
     ORDER BY version DESC,id DESC LIMIT $4`,
    [key, beforeVersion, sourceId, sourceId ? 1 : historyPageSize + 1]
  );
  return rows.flatMap(({ id, snapshot }) => {
    const parsed = snapshotSchema.safeParse(snapshot);
    return parsed.success && keyFor(parsed.data.capability) === key
      ? [{ id, setting: parsed.data }]
      : [];
  });
}

async function readRollbackDraft(
  client: QueryClient,
  capability: Capability,
  baseVersion: number,
  draftId: string | null = null,
  sourceId: string | null = null
) {
  const { rows } = await client.query<{ id: string; value: unknown }>(
    `WITH drafts AS (
       SELECT id,created_at,CASE WHEN metadata IS JSON OBJECT THEN metadata::jsonb ELSE '{}'::jsonb END AS value
       FROM audit_log WHERE event=$1 AND ($4::text IS NULL OR id=$4)
     )
     SELECT id,value FROM drafts
     WHERE value->>'key'=$2 AND value->'baseVersion'=to_jsonb($3::integer)
       AND ($5::text IS NULL OR value->>'sourceId'=$5)
     ORDER BY created_at DESC,id DESC LIMIT 1`,
    [rollbackEvent, keyFor(capability), baseVersion, draftId, sourceId]
  );
  const row = rows[0];
  if (!row) return null;
  const parsed = rollbackDraftSchema.safeParse(row.value);
  if (!parsed.success || parsed.data.setting.capability !== capability) return null;
  return { id: row.id, ...parsed.data };
}

@Injectable()
export class MaintenanceService {
  async list(): Promise<MaintenanceSetting[]> {
    const keys = capabilities.map(keyFor);
    const rows = (
      await getDbPool().query<ConfigRow>(
        'SELECT key,value,version,updated_at FROM app_config WHERE key=ANY($1::text[])',
        [keys]
      )
    ).rows;
    const byKey = new Map(rows.map((row) => [row.key, row]));
    return capabilities.map((capability) => settingFor(capability, byKey.get(keyFor(capability))));
  }

  async get(capability: Capability): Promise<MaintenanceSetting> {
    const row = (
      await getDbPool().query<ConfigRow>(
        'SELECT key,value,version,updated_at FROM app_config WHERE key=$1',
        [keyFor(capability)]
      )
    ).rows[0];
    return settingFor(capability, row);
  }

  async requireAvailable(capability: Capability): Promise<void> {
    const setting = await this.get(capability);
    if (!setting.active) return;
    throw new ServiceUnavailableException({
      error: ErrorCodes.MAINTENANCE_ACTIVE.code,
      capability,
      reason: isStandardMaintenanceNotice(setting.reason) ? null : setting.reason,
      estimatedUntil: setting.estimatedUntil,
      supportUrl: '/tickets',
    });
  }

  async rollbackHistory(capability: Capability, beforeVersion?: number) {
    const current = await this.get(capability);
    const pool = getDbPool();
    const [history, draft] = await Promise.all([
      readHistory(
        pool,
        keyFor(capability),
        Math.min(current.version, beforeVersion ?? current.version)
      ),
      readRollbackDraft(pool, capability, current.version),
    ]);
    const items = history.slice(0, historyPageSize);
    return {
      baseVersion: current.version,
      items,
      nextBeforeVersion: history.length > historyPageSize ? items.at(-1)!.setting.version : null,
      draft,
    };
  }

  async stageRollback(
    capability: Capability,
    input: z.infer<typeof maintenanceRollbackSchema>,
    actor: StaffActor,
    ip: string
  ) {
    return this.mutate(capability, input.expectedVersion, actor, async (client, key, before) => {
      const [source] = await readHistory(client, key, before.version, input.sourceId);
      if (!source) throw new NotFoundException('Maintenance revision not found');
      const existing = await readRollbackDraft(client, capability, before.version, null, source.id);
      if (existing) return existing;
      const draft = {
        id: uuidv7(),
        sourceId: source.id,
        baseVersion: before.version,
        setting: source.setting,
      };
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip,created_at)
         VALUES($1,$2,$3,$4::jsonb,$5,$6,NOW())`,
        [
          draft.id,
          actor.userId,
          rollbackEvent,
          JSON.stringify({
            key,
            sourceId: draft.sourceId,
            baseVersion: draft.baseVersion,
            setting: draft.setting,
          }),
          correlationIdStorage.getStore() ?? uuidv7(),
          ip,
        ]
      );
      return draft;
    });
  }

  private async mutate<T>(
    capability: Capability,
    expectedVersion: number,
    actor: StaffActor,
    action: (client: PoolClient, key: string, before: MaintenanceSetting) => Promise<T>
  ): Promise<T> {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actor.userId, 'admin:config:write');
      await requireSessionStepUp(client, actor);
      const key = keyFor(capability);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
      const before = settingFor(
        capability,
        (
          await client.query<ConfigRow>(
            'SELECT key,value,version,updated_at FROM app_config WHERE key=$1 FOR UPDATE',
            [key]
          )
        ).rows[0]
      );
      if (before.version !== expectedVersion)
        throw new ConflictException('Maintenance setting changed. Reload before saving.');
      const result = await action(client, key, before);
      await requireSessionStepUp(client, actor);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async update(
    capability: Capability,
    input: z.infer<typeof updateSchema>,
    actor: StaffActor,
    ip: string
  ): Promise<MaintenanceSetting> {
    return this.mutate(capability, input.expectedVersion, actor, async (client, key, before) => {
      const rollback = input.rollbackDraftId
        ? await readRollbackDraft(client, capability, before.version, input.rollbackDraftId)
        : null;
      if (input.rollbackDraftId && !rollback)
        throw new ConflictException('Maintenance recovery draft is no longer current.');
      if (input.active && Date.parse(input.estimatedUntil!) <= Date.now())
        throw new ConflictException('Maintenance deadline elapsed before saving.');
      const privateReason = input.active && input.publishReason === false ? input.reason : null;
      const value = {
        active: input.active,
        reason: privateReason ? standardMaintenanceNotice : input.active ? input.reason : null,
        estimatedUntil: input.active ? input.estimatedUntil : null,
        owner: input.active ? input.owner : null,
      };
      const updated = (
        await client.query<ConfigRow>(
          `INSERT INTO app_config(key,value,version,updated_at) VALUES($1,$2::jsonb,1,NOW())
           ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,
             version=app_config.version+1,updated_at=NOW()
           RETURNING key,value,version,updated_at`,
          [key, JSON.stringify(value)]
        )
      ).rows[0]!;
      const after = settingFor(capability, updated);
      await client.query(
        "UPDATE config_version SET version=version+1,updated_at=NOW() WHERE id='global'"
      );
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip,created_at)
         VALUES($1,$2,'config_change',$3::jsonb,$4,$5,NOW())`,
        [
          uuidv7(),
          actor.userId,
          JSON.stringify({
            key,
            previous: before,
            next: after,
            sessionId: actor.sessionId,
            ...(rollback
              ? { rollbackDraftId: rollback.id, restoredFromVersion: rollback.setting.version }
              : {}),
            ...(privateReason ? { privateReason } : {}),
          }),
          correlationIdStorage.getStore() ?? uuidv7(),
          ip,
        ]
      );
      return after;
    });
  }
}
