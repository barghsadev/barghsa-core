import { HttpException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { ErrorCodes } from '@barghsa/shared/errors';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';
import { requireSessionStepUp } from '../session/session-step-up.js';
import type { ValidatedSession } from '../session/session.service.js';

const CONFIG_KEY = 'auth_otp';
const settingsSchema = z.object({ ttlSeconds: z.number().int().min(60).max(900) }).strict();
export const UpdateOtpConfigSchema = settingsSchema.extend({
  expectedVersion: z.number().int().min(0).max(2147483646),
});
export interface OtpConfig {
  ttlSeconds: number;
  version: number;
}

/** Read on issuance so a committed change applies without a restart or stale cache. */
export async function readOtpConfig(
  client: Pick<PoolClient, 'query'> = getDbPool()
): Promise<OtpConfig> {
  const result = await client.query<{ value: unknown; version: number }>(
    'SELECT value,version FROM app_config WHERE key=$1',
    [CONFIG_KEY]
  );
  const row = result.rows[0];
  if (!row) return { ttlSeconds: 300, version: 0 };
  const parsed = settingsSchema.safeParse(row.value);
  if (!parsed.success || !Number.isSafeInteger(row.version) || row.version < 1) {
    throw new HttpException({ statusCode: 503, error: 'CONFIG:STORED_VALUE_INVALID' }, 503);
  }
  return { ...parsed.data, version: row.version };
}

export async function updateOtpConfig(
  input: z.infer<typeof UpdateOtpConfigSchema>,
  actor: Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>,
  ip: string
): Promise<OtpConfig> {
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    await requireStaffMutationPermission(client, actor.userId, 'admin:config:write');
    await requireSessionStepUp(client, actor);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [CONFIG_KEY]);
    const previous = await readOtpConfig(client);
    if (previous.version !== input.expectedVersion) {
      throw new HttpException({ statusCode: 409, error: 'CONFIG:VERSION_CONFLICT' }, 409);
    }
    const saved = await client.query<{ version: number }>(
      `INSERT INTO app_config(key,value,version,updated_at)
       VALUES ($1,$2::jsonb,1,clock_timestamp())
       ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,
         version=app_config.version+1,updated_at=clock_timestamp() RETURNING version`,
      [CONFIG_KEY, JSON.stringify({ ttlSeconds: input.ttlSeconds })]
    );
    const current = { ttlSeconds: input.ttlSeconds, version: saved.rows[0]!.version };
    const versionUpdate = await client.query(
      "UPDATE config_version SET version=version+1,updated_at=clock_timestamp() WHERE id='global'"
    );
    if (versionUpdate.rowCount !== 1) throw new Error('Configuration version unavailable');
    await client.query(
      `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip,created_at)
       VALUES ($1,$2,'change_recorded',$3,$4,$5,clock_timestamp())`,
      [
        uuidv7(),
        actor.userId,
        JSON.stringify({ entity: CONFIG_KEY, previous, current }),
        correlationIdStorage.getStore() ?? uuidv7(),
        ip,
      ]
    );
    // Reject expiry, CSRF rotation or lost step-up across any database wait.
    await requireSessionStepUp(client, actor);
    await client.query('COMMIT');
    return current;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export function parseOtpConfigUpdate(raw: unknown): z.infer<typeof UpdateOtpConfigSchema> {
  const parsed = UpdateOtpConfigSchema.safeParse(raw);
  if (!parsed.success)
    throw new HttpException(
      { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
      400
    );
  return parsed.data;
}
