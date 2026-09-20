import { ConflictException, NotFoundException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { requireSessionStepUp } from '../session/session-step-up.js';
import type { ValidatedSession } from '../session/session.service.js';
export type ContractActor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;
type Actor = ContractActor;
export async function contractIdempotency<T, Input extends { idempotencyKey: string }>(
  client: PoolClient,
  kind: string,
  input: Input,
  actor: Actor,
  work: () => Promise<T>
): Promise<T> {
  const key = actor.userId + ':' + input.idempotencyKey;
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [kind + ':' + key]);
  const prior = (
    await client.query<{ matches: boolean; result: T }>(
      "SELECT response->'request'=$3::jsonb AS matches,response->'result' AS result FROM idempotency_keys WHERE entity_type=$1 AND idempotency_key=$2",
      [kind, key, JSON.stringify(input)]
    )
  ).rows[0];
  if (prior) {
    if (!prior.matches)
      throw new ConflictException('Idempotency key belongs to a different request');
    return prior.result;
  }
  const result = await work();
  await client.query(
    'INSERT INTO idempotency_keys(entity_type,idempotency_key,response) VALUES($1,$2,$3::jsonb)',
    [kind, key, JSON.stringify({ request: input, result })]
  );
  return result;
}
export async function staffContractMutation<T>(
  profileId: string,
  actor: Actor,
  work: (client: PoolClient, archived: boolean) => Promise<T>
): Promise<T> {
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const profile = (
      await client.query<{ archived: boolean }>(
        'SELECT archived FROM profiles WHERE id=$1 FOR SHARE',
        [profileId]
      )
    ).rows[0];
    if (!profile) throw new NotFoundException();
    await requireStaffMutationPermission(client, actor.userId, 'contracts:write');
    await requireSessionStepUp(client, actor);
    const result = await work(client, profile.archived);
    await requireSessionStepUp(client, actor);
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
