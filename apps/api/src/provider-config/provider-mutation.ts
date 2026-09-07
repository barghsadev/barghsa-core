import { v7 as uuidv7 } from 'uuid';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import type { PoolClient, ProviderPool } from './provider-config.di.js';

/** Serialize a provider family's mutations and retain authority through its audit commit. */
export async function mutateProvider<T extends { id: string; status: string }>(
  pool: ProviderPool,
  actorUserId: string | undefined,
  channel: 'email' | 'sms',
  event: string,
  work: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await requireStaffMutationPermission(
      client,
      actorUserId ?? '',
      'admin:notification-providers:edit'
    );
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `notification-provider:${channel}`,
    ]);
    const result = await work(client);
    await client.query(
      `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,created_at)
       VALUES($1,$2,$3,$4::jsonb,$5,NOW())`,
      [
        uuidv7(),
        actorUserId,
        `${channel}_provider_${event}`,
        JSON.stringify({ providerId: result.id, status: result.status }),
        uuidv7(),
      ]
    );
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
