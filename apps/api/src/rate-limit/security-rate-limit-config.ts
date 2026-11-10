import { HttpException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import {
  securityRateLimitConfigKey,
  securityRateLimitPolicies,
  securityRateLimitPolicyKeys,
  type SecurityRateLimitPolicy,
} from '@barghsa/shared/rate-limit';
import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { rejectContentFields } from '../admin/content-input-fields.js';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';
import { requireSessionStepUp } from '../session/session-step-up.js';
import type { ValidatedSession } from '../session/session.service.js';

const positiveLimit = z.number().int().min(1).max(50);
const reason = z.string().trim().min(10).max(300);
const storedPolicy = z
  .object({
    limit: positiveLimit,
    emergency: z
      .object({
        limit: positiveLimit,
        owner: z.string().min(1),
        reason,
        expiresAt: z.string().datetime(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const SecurityRateLimitUpdateSchema = z
  .object({
    policy: z.enum(
      securityRateLimitPolicyKeys as [SecurityRateLimitPolicy, ...SecurityRateLimitPolicy[]]
    ),
    limit: positiveLimit,
    expectedVersion: z.number().int().min(0).max(2147483646),
    emergency: z.discriminatedUnion('operation', [
      z.object({ operation: z.literal('keep') }).strict(),
      z.object({ operation: z.literal('clear'), reason }).strict(),
      z
        .object({
          operation: z.literal('set'),
          limit: positiveLimit,
          minutes: z.number().int().min(5).max(1440),
          reason,
        })
        .strict(),
    ]),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.limit > securityRateLimitPolicies[input.policy].ceiling) {
      context.addIssue({
        code: 'custom',
        path: ['limit'],
        message: 'Limit exceeds the action ceiling',
      });
    }
    if (input.emergency.operation === 'set' && input.emergency.limit >= input.limit) {
      context.addIssue({
        code: 'custom',
        path: ['emergency'],
        message: 'Emergency limit must tighten the rule',
      });
    }
  });

type Update = z.infer<typeof SecurityRateLimitUpdateSchema>;
type StoredPolicy = z.infer<typeof storedPolicy>;
type ConfigRow = { key: string; value: unknown; version: number; now: Date };

function snapshot(policy: SecurityRateLimitPolicy, row?: ConfigRow) {
  const { ceiling, windowMs } = securityRateLimitPolicies[policy];
  const defaults = { policy, ceiling, windowMs, version: 0, limit: ceiling, emergency: null };
  if (!row) return defaults;
  const parsed = storedPolicy.safeParse(row.value);
  if (
    !parsed.success ||
    parsed.data.limit > ceiling ||
    (parsed.data.emergency?.limit ?? 1) > ceiling ||
    !Number.isSafeInteger(row.version) ||
    row.version < 1
  ) {
    throw new HttpException({ error: 'CONFIG:STORED_VALUE_INVALID' }, 503);
  }
  const emergency = parsed.data.emergency;
  return {
    ...defaults,
    version: row.version,
    limit: parsed.data.limit,
    emergency: emergency && {
      ...emergency,
      active: Date.parse(emergency.expiresAt) > row.now.getTime(),
    },
  };
}

export async function readSecurityRateLimitConfig() {
  const rows = await getDbPool().query<ConfigRow>(
    'SELECT key,value,version,clock_timestamp() AS now FROM app_config WHERE key=ANY($1::text[])',
    [securityRateLimitPolicyKeys.map(securityRateLimitConfigKey)]
  );
  const byKey = new Map(rows.rows.map((row) => [row.key, row]));
  return {
    policies: securityRateLimitPolicyKeys.map((policy) =>
      snapshot(policy, byKey.get(securityRateLimitConfigKey(policy)))
    ),
  };
}

export function parseSecurityRateLimitUpdate(raw: unknown): Update {
  const parsed = SecurityRateLimitUpdateSchema.safeParse(raw);
  if (!parsed.success) rejectContentFields(parsed.error.issues, ['policy', 'limit', 'emergency']);
  return parsed.data;
}

export async function updateSecurityRateLimitConfig(
  input: Update,
  actor: Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>,
  ip: string
) {
  const client = await getDbPool().connect();
  const key = securityRateLimitConfigKey(input.policy);
  try {
    await client.query('BEGIN');
    await requireStaffMutationPermission(client, actor.userId, 'admin:config:write');
    await requireSessionStepUp(client, actor);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
    const selected = await client.query<ConfigRow>(
      'SELECT key,value,version,clock_timestamp() AS now FROM app_config WHERE key=$1',
      [key]
    );
    const previous = snapshot(input.policy, selected.rows[0]);
    if (previous.version !== input.expectedVersion) {
      throw new HttpException({ error: 'CONFIG:VERSION_CONFLICT' }, 409);
    }
    let emergency: StoredPolicy['emergency'] = null;
    if (input.emergency.operation === 'keep' && previous.emergency) {
      const { limit, owner, reason, expiresAt } = previous.emergency;
      emergency = { limit, owner, reason, expiresAt };
    }
    if (input.emergency.operation === 'set') {
      const { limit, minutes, reason } = input.emergency;
      const expiry = await client.query<{ expires_at: Date }>(
        "SELECT clock_timestamp() + $1::integer * interval '1 minute' AS expires_at",
        [minutes]
      );
      emergency = {
        limit,
        owner: actor.userId,
        reason,
        expiresAt: expiry.rows[0]!.expires_at.toISOString(),
      };
    }
    const saved = await client.query<ConfigRow>(
      `INSERT INTO app_config(key,value,version,updated_at)
       VALUES ($1,$2::jsonb,1,clock_timestamp())
       ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,
         version=app_config.version+1,updated_at=clock_timestamp()
       RETURNING key,value,version,clock_timestamp() AS now`,
      [key, JSON.stringify({ limit: input.limit, emergency })]
    );
    const current = snapshot(input.policy, saved.rows[0]);
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
        JSON.stringify({
          entity: key,
          previous,
          current,
          emergencyOperation: input.emergency.operation,
          ...(input.emergency.operation === 'clear' && { reason: input.emergency.reason }),
        }),
        correlationIdStorage.getStore() ?? uuidv7(),
        ip,
      ]
    );
    await requireSessionStepUp(client, actor);
    await client.query('COMMIT');
    return current;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
