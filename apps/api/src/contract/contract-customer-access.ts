import { HttpException, NotFoundException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import type { PoolClient } from 'pg';
import { ErrorCodes } from '@barghsa/shared/errors';
import { activeProfileSql } from '../profiles/profile-context.js';
import { requireCurrentSession, requireSessionStepUp } from '../session/session-step-up.js';
import type { ContractActor } from './contract-transactions.js';
export async function customerContractAccess<T>(
  actor: ContractActor,
  accept: boolean,
  work: (client: PoolClient, profileId: string) => Promise<T>
): Promise<T> {
  const permission = accept ? 'contracts:sign' : 'contracts:view';
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const selected = (
      await client.query<{ id: string }>(activeProfileSql(permission), [actor.userId])
    ).rows[0]?.id;
    if (!selected) throw new NotFoundException();
    const profile = (
      await client.query<{ archived: boolean }>(
        'SELECT archived FROM profiles WHERE id=$1 FOR SHARE',
        [selected]
      )
    ).rows[0];
    if (!profile || profile.archived) throw new NotFoundException();
    const account = (
      await client.query(
        'SELECT disabled_at,activation_token FROM users WHERE user_id=$1 FOR UPDATE',
        [actor.userId]
      )
    ).rows[0];
    if (!account || account.disabled_at || account.activation_token)
      throw new HttpException({ error: ErrorCodes.AUTH_UNAUTHENTICATED.code }, 401);
    const checkSession = accept ? requireSessionStepUp : requireCurrentSession;
    await checkSession(client, actor);
    await client.query(
      'SELECT role FROM profile_agents WHERE profile_id=$1 AND user_id=$2 FOR SHARE',
      [selected, actor.userId]
    );
    const recheck = async () => {
      if (
        (await client.query<{ id: string }>(activeProfileSql(permission), [actor.userId])).rows[0]
          ?.id !== selected
      )
        throw new NotFoundException();
    };
    await recheck();
    const result = await work(client, selected);
    await recheck();
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
