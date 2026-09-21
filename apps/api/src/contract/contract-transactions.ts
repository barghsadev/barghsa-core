import { NotFoundException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { requireCurrentSession, requireSessionStepUp } from '../session/session-step-up.js';
import type { ValidatedSession } from '../session/session.service.js';
export type ContractActor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;
type Actor = ContractActor;
export { idempotentMutation as contractIdempotency } from '../database/idempotency.js';
export async function staffContractMutation<T>(
  profileId: string,
  actor: Actor,
  work: (client: PoolClient, archived: boolean) => Promise<T>,
  options: { financialReview?: boolean } = {}
): Promise<T> {
  return staffContractAccess(profileId, actor, work, options.financialReview === true, true);
}
export async function staffContractFinancialReview<T>(
  profileId: string,
  actor: Actor,
  work: (client: PoolClient, archived: boolean) => Promise<T>
): Promise<T> {
  return staffContractAccess(profileId, actor, work, true, false);
}
async function staffContractAccess<T>(
  profileId: string,
  actor: Actor,
  work: (client: PoolClient, archived: boolean) => Promise<T>,
  exclusiveProfile: boolean,
  mutation: boolean
): Promise<T> {
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const profile = (
      await client.query<{ archived: boolean }>(
        `SELECT archived FROM profiles WHERE id=$1 FOR ${exclusiveProfile ? 'UPDATE' : 'SHARE'}`,
        [profileId]
      )
    ).rows[0];
    if (!profile) throw new NotFoundException();
    await requireStaffMutationPermission(client, actor.userId, 'contracts:write');
    const checkSession = mutation ? requireSessionStepUp : requireCurrentSession;
    await checkSession(client, actor);
    const result = await work(client, profile.archived);
    await checkSession(client, actor);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function auditContract(
  client: PoolClient,
  id: string,
  versionId: string,
  event: string,
  actor: Actor,
  ip: string,
  details: Record<string, unknown> = {}
) {
  await client.query(
    'INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip) VALUES($1,$2,$3,$4::jsonb,$5,$6)',
    [
      uuidv7(),
      actor.userId,
      event,
      JSON.stringify({ ...details, contractId: id, versionId }),
      uuidv7(),
      ip,
    ]
  );
}
