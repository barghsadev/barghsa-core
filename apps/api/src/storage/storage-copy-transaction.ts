import { createDirectDbPool, getDbPool } from '@barghsa/db';
import type { PoolClient } from 'pg';

export async function withCopyTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
  directClient?: PoolClient
): Promise<T> {
  const client = directClient ?? (await getDbPool().connect());
  let releaseError: Error | undefined;
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      releaseError = new Error('Storage copy transaction rollback failed');
    }
    throw error;
  } finally {
    if (!directClient) client.release(releaseError);
  }
}

/** Serialize exact retries across API processes without holding a business transaction. */
export async function withCopyReplayLock<T>(
  key: string | null,
  work: (client?: PoolClient) => Promise<T>
): Promise<T> {
  if (!key) return work();
  const client = await createDirectDbPool().connect();
  let released = false;
  try {
    await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [key]);
    const result = await work(client);
    released =
      (
        await client.query<{ released: boolean }>(
          'SELECT pg_advisory_unlock(hashtextextended($1,0)) AS released',
          [key]
        )
      ).rows[0]?.released === true;
    return result;
  } finally {
    client.release(!released);
  }
}
