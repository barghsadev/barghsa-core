import { ConflictException, Injectable } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
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
export const updateSchema = settingSchema
  .extend({ expectedVersion: z.number().int().nonnegative() })
  .refine(
    (value) =>
      !value.active ||
      (Boolean(value.reason && value.owner && value.estimatedUntil) &&
        Date.parse(value.estimatedUntil!) > Date.now()),
    {
      message: 'Reason, owner, and a future estimated return are required during maintenance',
    }
  );

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

  async update(
    capability: Capability,
    input: z.infer<typeof updateSchema>,
    actor: Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>,
    ip: string
  ): Promise<MaintenanceSetting> {
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
      if (before.version !== input.expectedVersion)
        throw new ConflictException('Maintenance setting changed. Reload before saving.');
      const value = {
        active: input.active,
        reason: input.active ? input.reason : null,
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
          JSON.stringify({ key, previous: before, next: after, sessionId: actor.sessionId }),
          correlationIdStorage.getStore() ?? uuidv7(),
          ip,
        ]
      );
      await requireSessionStepUp(client, actor);
      await client.query('COMMIT');
      return after;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}
