import { ConflictException, HttpException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { ErrorCodes } from '@barghsa/shared/errors';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { ValidatedSession } from '../session/session.service.js';
import { requireCurrentSession, requireSessionStepUp } from '../session/session-step-up.js';
import { requireStaffMutationPermission } from './staff-mutation-permission.js';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';

const ACTIVE_KEY = 'profile_verification_mode';
const DRAFT_KEY = 'profile_verification_mode_draft';
export const VERIFICATION_MODE_LOCK = 'profile-verification-policy';
type Mode = 'DISABLED' | 'MANUAL' | 'API';
export interface VerificationModeConfig {
  mode: Mode;
  version: number;
  draft: Mode | null;
}
export interface VerificationModeChange {
  mode: Mode;
  expectedVersion: number;
  action: 'draft' | 'activate';
}

async function readState(db: Pool | PoolClient) {
  const result = await db.query(
    `SELECT key,value,version FROM app_config WHERE key=ANY($1::text[])`,
    [[ACTIVE_KEY, DRAFT_KEY, 'verification.required', 'verification.method']]
  );
  const rows = new Map(result.rows.map((row) => [row.key, row]));
  const active = rows.get(ACTIVE_KEY);
  const draft = rows.get(DRAFT_KEY);
  // Match the runtime's legacy fallback; invalid explicit values fail closed.
  const raw = active?.value;
  const mode: Mode =
    raw === 'DISABLED' || raw === 'MANUAL' || raw === 'API'
      ? raw
      : raw != null
        ? 'MANUAL'
        : rows.get('verification.required')?.value === true
          ? rows.get('verification.method')?.value === 'api'
            ? 'API'
            : 'MANUAL'
          : 'DISABLED';
  return {
    config: {
      mode,
      version: Number(draft?.version ?? 0),
      draft: draft?.value?.mode ?? null,
    } as VerificationModeConfig,
    activeVersion: Number(active?.version ?? 0),
    baseVersion: draft?.value?.baseVersion,
    baseMode: draft?.value?.baseMode,
  };
}

export async function readVerificationModeConfig(): Promise<VerificationModeConfig> {
  return (await readState(getDbPool())).config;
}

export async function changeVerificationMode(
  change: VerificationModeChange,
  actor: Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>,
  ip: string
): Promise<VerificationModeConfig> {
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [VERIFICATION_MODE_LOCK]);
    await requireStaffMutationPermission(client, actor.userId, 'admin:config:write');
    const authorize = change.action === 'activate' ? requireSessionStepUp : requireCurrentSession;
    await authorize(client, actor);
    if (change.mode === 'API')
      throw new HttpException({ error: ErrorCodes.VERIFICATION_PROVIDER_UNAVAILABLE.code }, 503);
    await client.query('SELECT key FROM app_config WHERE key=$1 FOR UPDATE', [ACTIVE_KEY]);
    const current = await readState(client);
    if (change.expectedVersion !== current.config.version)
      throw new ConflictException('Verification settings changed. Reload before saving.');
    if (change.action === 'activate') {
      if (
        current.config.draft !== change.mode ||
        current.baseVersion !== current.activeVersion ||
        current.baseMode !== current.config.mode
      )
        throw new ConflictException('Verification draft changed. Reload before activation.');
      await client.query(
        `INSERT INTO app_config(key,value,version,updated_at) VALUES ($1,$2::jsonb,1,NOW())
         ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,version=app_config.version+1,updated_at=NOW()`,
        [ACTIVE_KEY, JSON.stringify(change.mode)]
      );
      await client.query(
        "UPDATE config_version SET version=version+1,updated_at=NOW() WHERE id='global'"
      );
    }
    const next: VerificationModeConfig = {
      mode: change.action === 'activate' ? change.mode : current.config.mode,
      version: current.config.version + 1,
      draft: change.action === 'draft' ? change.mode : null,
    };
    // Keep the revision after activation so stale drafts cannot be replayed.
    await client.query(
      `INSERT INTO app_config(key,value,version,updated_at) VALUES ($1,$2::jsonb,$3,NOW())
       ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,version=EXCLUDED.version,updated_at=NOW()`,
      [
        DRAFT_KEY,
        JSON.stringify({
          mode: next.draft,
          baseVersion: current.activeVersion,
          baseMode: current.config.mode,
        }),
        next.version,
      ]
    );
    await client.query(
      `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip,created_at)
       VALUES($1,$2,'config_change',$3::jsonb,$4,$5,NOW())`,
      [
        randomUUID(),
        actor.userId,
        JSON.stringify({
          key: ACTIVE_KEY,
          action: change.action,
          previous: current.config,
          next,
          sessionId: actor.sessionId,
        }),
        correlationIdStorage.getStore() ?? randomUUID(),
        ip,
      ]
    );
    await authorize(client, actor);
    await client.query('COMMIT');
    return next;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
