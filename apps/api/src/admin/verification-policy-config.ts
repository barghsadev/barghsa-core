import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import {
  DEFAULT_VERIFICATION_POLICY,
  isVerificationPolicy,
  verificationPolicyBasis,
  type VerificationPolicy,
  type VerificationPolicyView,
} from '@barghsa/shared/verification';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { ValidatedSession } from '../session/session.service.js';
import { requireCurrentSession, requireSessionStepUp } from '../session/session-step-up.js';
import { requireStaffMutationPermission } from './staff-mutation-permission.js';
import { VERIFICATION_MODE_LOCK } from './verification-mode-config.js';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';

export const VERIFICATION_POLICY_KEY = 'profile_verification_policy';
const DRAFT_KEY = `${VERIFICATION_POLICY_KEY}_draft`;
async function state(db: Pool | PoolClient) {
  const rows = (
    await db.query('SELECT key,value,version FROM app_config WHERE key=ANY($1::text[])', [
      [VERIFICATION_POLICY_KEY, DRAFT_KEY],
    ])
  ).rows;
  const active = rows.find((row) => row.key === VERIFICATION_POLICY_KEY);
  const draft = rows.find((row) => row.key === DRAFT_KEY);
  const policy: unknown = active ? active.value : structuredClone(DEFAULT_VERIFICATION_POLICY);
  const proposal: unknown = draft?.value?.policy ?? null;
  if (!isVerificationPolicy(policy) || (proposal !== null && !isVerificationPolicy(proposal)))
    throw new ServiceUnavailableException('Verification policy is invalid');
  return {
    view: {
      active: policy,
      draft: proposal,
      version: Number(draft?.version ?? 0),
    } as VerificationPolicyView,
    activeVersion: Number(active?.version ?? 0),
    baseVersion: draft?.value?.baseVersion,
  };
}
export async function readVerificationPolicyConfig(): Promise<VerificationPolicyView> {
  return (await state(getDbPool())).view;
}
/** Business transactions hold this table lock through their final authority check/commit. */
export async function lockVerificationPolicy(client: PoolClient): Promise<VerificationPolicy> {
  await client.query('LOCK TABLE app_config IN SHARE MODE');
  return (await state(client)).view.active;
}
export async function changeVerificationPolicy(
  change: { policy: VerificationPolicy; expectedVersion: number; action: 'draft' | 'activate' },
  actor: Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>,
  ip: string
): Promise<VerificationPolicyView> {
  if (!isVerificationPolicy(change.policy))
    throw new BadRequestException('Invalid verification policy');
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [VERIFICATION_MODE_LOCK]);
    await requireStaffMutationPermission(client, actor.userId, 'admin:config:write');
    const authorize = change.action === 'activate' ? requireSessionStepUp : requireCurrentSession;
    await authorize(client, actor);
    const current = await state(client);
    if (change.expectedVersion !== current.view.version)
      throw new ConflictException('Verification policy changed; reload before saving');
    if (change.action === 'activate') {
      if (
        !current.view.draft ||
        current.baseVersion !== current.activeVersion ||
        verificationPolicyBasis(change.policy) !== verificationPolicyBasis(current.view.draft)
      )
        throw new ConflictException('Verification policy draft changed; reload before activation');
      await client.query(
        `INSERT INTO app_config(key,value,version,updated_at) VALUES($1,$2::jsonb,1,NOW())
         ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,version=app_config.version+1,updated_at=NOW()`,
        [VERIFICATION_POLICY_KEY, JSON.stringify(change.policy)]
      );
      await client.query(
        "UPDATE config_version SET version=version+1,updated_at=NOW() WHERE id='global'"
      );
    }
    const next: VerificationPolicyView = {
      active: change.action === 'activate' ? change.policy : current.view.active,
      draft: change.action === 'draft' ? change.policy : null,
      version: current.view.version + 1,
    };
    await client.query(
      `INSERT INTO app_config(key,value,version,updated_at) VALUES($1,$2::jsonb,$3,NOW())
       ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,version=EXCLUDED.version,updated_at=NOW()`,
      [
        DRAFT_KEY,
        JSON.stringify({ policy: next.draft, baseVersion: current.activeVersion }),
        next.version,
      ]
    );
    await client.query(
      `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
       VALUES($1,$2,'config_change',$3::jsonb,$4,$5)`,
      [
        randomUUID(),
        actor.userId,
        JSON.stringify({
          key: VERIFICATION_POLICY_KEY,
          action: change.action,
          previous: current.view,
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
