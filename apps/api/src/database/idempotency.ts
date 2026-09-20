import { ConflictException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { ValidatedSession } from '../session/session.service.js';

export async function idempotentMutation<T, Input extends { idempotencyKey: string }>(
  client: PoolClient,
  kind: string,
  input: Input,
  actor: Pick<ValidatedSession, 'userId'>,
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
