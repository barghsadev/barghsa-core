import { getDbPool } from '@barghsa/db';
import type { PoolClient } from 'pg';
import {
  lockFinancialSubmissionActor,
  type FinancialSubmissionActor,
} from '../finance/financial-submission-actor.js';
import { requireCurrentSession } from '../session/session-step-up.js';

/** Keep customer authority valid until a wallet read or empty-wallet creation completes. */
export async function withCustomerWalletAccess<T>(
  actor: FinancialSubmissionActor,
  profileId: string,
  permission: 'wallet:view' | 'wallet:charge',
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    await lockFinancialSubmissionActor(client, actor, profileId, permission);
    const result = await operation(client);
    await requireCurrentSession(client, actor);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
