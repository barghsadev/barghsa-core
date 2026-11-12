import { HttpException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import {
  securityRateLimitConfigKey,
  securityRateLimitPolicies,
  securityRateLimitPolicyKeys,
  type SecurityRateLimitPolicy,
} from '@barghsa/shared/rate-limit';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { rejectContentFields } from '../admin/content-input-fields.js';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { withStaffReadAuthority, type StaffReadActor } from '../admin/staff-read-authority.js';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';
import { requireSessionStepUp } from '../session/session-step-up.js';

const positiveLimit = z.number().int().min(1).max(50);
const reason = z.string().trim().min(10).max(300);
const policyKey = z.enum(
  securityRateLimitPolicyKeys as [SecurityRateLimitPolicy, ...SecurityRateLimitPolicy[]]
);
const previousVersion = z.number().int().min(1).max(2147483646);
const recoveryPageSize = 20;
const recoveryEvent = 'security_rate_limit.rollback_draft';
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
    policy: policyKey,
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

export const SecurityRateLimitHistorySchema = z.strictObject({
  policy: policyKey,
  beforeVersion: z
    .string()
    .regex(/^[1-9]\d{0,9}$/)
    .transform(Number)
    .pipe(previousVersion)
    .optional(),
});
export const SecurityRateLimitStageSchema = z.strictObject({
  policy: policyKey,
  expectedVersion: previousVersion,
  sourceId: z.string().uuid(),
});
export const SecurityRateLimitActivateSchema = z.strictObject({
  policy: policyKey,
  expectedVersion: previousVersion,
  draftId: z.string().uuid(),
});
const recoveryDraft = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid(),
  sourceVersion: previousVersion,
  baseVersion: previousVersion,
  limit: positiveLimit,
});
type RecoveryDraft = z.infer<typeof recoveryDraft>;

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

export async function readSecurityRateLimitConfig(actor: StaffReadActor) {
  return withStaffReadAuthority(actor, 'admin:config:read', async (client) => {
    const rows = await client.query<ConfigRow>(
      'SELECT key,value,version,clock_timestamp() AS now FROM app_config WHERE key=ANY($1::text[])',
      [securityRateLimitPolicyKeys.map(securityRateLimitConfigKey)]
    );
    const byKey = new Map(rows.rows.map((row) => [row.key, row]));
    return {
      policies: securityRateLimitPolicyKeys.map((policy) =>
        snapshot(policy, byKey.get(securityRateLimitConfigKey(policy)))
      ),
    };
  });
}

export function parseSecurityRateLimitUpdate(raw: unknown): Update {
  const parsed = SecurityRateLimitUpdateSchema.safeParse(raw);
  if (!parsed.success) rejectContentFields(parsed.error.issues, ['policy', 'limit', 'emergency']);
  return parsed.data;
}

async function readPolicy(client: PoolClient, policy: SecurityRateLimitPolicy) {
  const selected = await client.query<ConfigRow>(
    'SELECT key,value,version,clock_timestamp() AS now FROM app_config WHERE key=$1',
    [securityRateLimitConfigKey(policy)]
  );
  return snapshot(policy, selected.rows[0]);
}

async function readRecoveryHistory(
  client: PoolClient,
  policy: SecurityRateLimitPolicy,
  beforeVersion: number,
  sourceId?: string
) {
  const { rows } = await client.query<{ id: string; version: string; limit: string }>(
    `WITH events AS (
       SELECT id,CASE WHEN metadata IS JSON OBJECT THEN metadata::jsonb ELSE '{}'::jsonb END AS data
       FROM audit_log WHERE event='change_recorded' AND ($3::text IS NULL OR id=$3)
     ), revisions AS (
       SELECT id,
         CASE WHEN jsonb_typeof(data->'current'->'version')='number' THEN (data->'current'->>'version')::numeric END AS version,
         CASE WHEN jsonb_typeof(data->'current'->'limit')='number' THEN (data->'current'->>'limit')::numeric END AS regular_limit
       FROM events WHERE data->>'entity'=$1
     )
     SELECT id,version::text,regular_limit::text AS limit FROM revisions
     WHERE version >= 1 AND version < $2 AND version=trunc(version)
       AND regular_limit BETWEEN 1 AND $4 AND regular_limit=trunc(regular_limit)
     ORDER BY revisions.version DESC,id DESC LIMIT $5`,
    [
      securityRateLimitConfigKey(policy),
      beforeVersion,
      sourceId ?? null,
      securityRateLimitPolicies[policy].ceiling,
      sourceId ? 1 : recoveryPageSize + 1,
    ]
  );
  return rows.map(({ id, version, limit }) => ({
    id,
    version: Number(version),
    limit: Number(limit),
  }));
}

async function readRecoveryDraft(
  client: PoolClient,
  policy: SecurityRateLimitPolicy,
  version: number
) {
  const { rows } = await client.query<{ id: string; data: Record<string, unknown> }>(
    `WITH events AS (
       SELECT id,created_at,CASE WHEN metadata IS JSON OBJECT THEN metadata::jsonb ELSE '{}'::jsonb END AS data
       FROM audit_log WHERE event=$1
     )
     SELECT id,data FROM events WHERE data->>'entity'=$2 AND data->>'baseVersion'=$3::text
     ORDER BY created_at DESC,id DESC LIMIT 1`,
    [recoveryEvent, securityRateLimitConfigKey(policy), version]
  );
  if (!rows[0]) return null;
  const parsed = recoveryDraft.safeParse({ ...rows[0].data, id: rows[0].id });
  return parsed.success &&
    parsed.data.baseVersion === version &&
    parsed.data.sourceVersion < version &&
    parsed.data.limit <= securityRateLimitPolicies[policy].ceiling
    ? parsed.data
    : null;
}

export function readSecurityRateLimitRecovery(
  input: z.infer<typeof SecurityRateLimitHistorySchema>,
  actor: StaffReadActor
) {
  return withStaffReadAuthority(actor, 'admin:config:read', async (client) => {
    const { policy, beforeVersion } = input;
    const { version } = await readPolicy(client, policy);
    const history = await readRecoveryHistory(
      client,
      policy,
      Math.min(version, beforeVersion ?? version)
    );
    const items = history.slice(0, recoveryPageSize);
    return {
      policy,
      baseVersion: version,
      items,
      nextBeforeVersion: history.length > recoveryPageSize ? items.at(-1)!.version : null,
      draft: await readRecoveryDraft(client, policy, version),
    };
  });
}

async function withPolicyWrite<T>(
  input: Pick<Update, 'policy' | 'expectedVersion'>,
  actor: StaffReadActor,
  write: (client: PoolClient, previous: ReturnType<typeof snapshot>) => Promise<T>
) {
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    await requireStaffMutationPermission(client, actor.userId, 'admin:config:write');
    await requireSessionStepUp(client, actor);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      securityRateLimitConfigKey(input.policy),
    ]);
    const previous = await readPolicy(client, input.policy);
    if (previous.version !== input.expectedVersion) {
      throw new HttpException({ error: 'CONFIG:VERSION_CONFLICT' }, 409);
    }
    const result = await write(client, previous);
    await requireSessionStepUp(client, actor);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function stageSecurityRateLimitRecovery(
  input: z.infer<typeof SecurityRateLimitStageSchema>,
  actor: StaffReadActor,
  ip: string
) {
  return withPolicyWrite(input, actor, async (client, previous) => {
    const [source] = await readRecoveryHistory(
      client,
      input.policy,
      previous.version,
      input.sourceId
    );
    if (!source) throw new HttpException({ error: 'CONFIG:REVISION_NOT_FOUND' }, 404);
    const existing = await readRecoveryDraft(client, input.policy, previous.version);
    if (existing?.sourceId === source.id) return existing;
    const draft = {
      id: uuidv7(),
      baseVersion: previous.version,
      sourceId: source.id,
      sourceVersion: source.version,
      limit: source.limit,
    };
    await client.query(
      `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,clock_timestamp())`,
      [
        draft.id,
        actor.userId,
        recoveryEvent,
        JSON.stringify({ entity: securityRateLimitConfigKey(input.policy), ...draft }),
        correlationIdStorage.getStore() ?? uuidv7(),
        ip,
      ]
    );
    return draft;
  });
}

export function activateSecurityRateLimitRecovery(
  input: z.infer<typeof SecurityRateLimitActivateSchema>,
  actor: StaffReadActor,
  ip: string
) {
  return withPolicyWrite(input, actor, async (client, previous) => {
    const draft = await readRecoveryDraft(client, input.policy, previous.version);
    if (draft?.id !== input.draftId)
      throw new HttpException({ error: 'CONFIG:VERSION_CONFLICT' }, 409);
    const current = await savePolicy(
      client,
      previous,
      {
        policy: input.policy,
        expectedVersion: input.expectedVersion,
        limit: draft.limit,
        emergency: { operation: 'keep' },
      },
      actor,
      ip,
      draft
    );
    return { draftId: draft.id, current };
  });
}

export function updateSecurityRateLimitConfig(input: Update, actor: StaffReadActor, ip: string) {
  return withPolicyWrite(input, actor, (client, previous) =>
    savePolicy(client, previous, input, actor, ip)
  );
}

async function savePolicy(
  client: PoolClient,
  previous: ReturnType<typeof snapshot>,
  input: Update,
  actor: StaffReadActor,
  ip: string,
  recovery?: RecoveryDraft
) {
  const key = securityRateLimitConfigKey(input.policy);
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
        ...(recovery && {
          rollbackDraftId: recovery.id,
          restoredFromVersion: recovery.sourceVersion,
        }),
      }),
      correlationIdStorage.getStore() ?? uuidv7(),
      ip,
    ]
  );
  return current;
}
