import type { Pool, PoolClient } from 'pg';

/** Call with a direct pool or an already checked-out direct client. */
export async function withMultipartUploadLock<T>(
  connection: Pool | PoolClient,
  key: string,
  work: (client: PoolClient) => Promise<T>
): Promise<{ acquired: false } | { acquired: true; value: T }> {
  const ownsClient = !('release' in connection);
  const client = ownsClient ? await connection.connect() : connection;
  const lockKey = `storage:multipart:${key}`;
  let locked = false;
  let releaseError: Error | undefined;
  let value: T;
  try {
    locked =
      (
        await client.query<{ acquired: boolean }>(
          'SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired',
          [lockKey]
        )
      ).rows[0]?.acquired === true;
    if (!locked) return { acquired: false };
    value = await work(client);
  } finally {
    if (locked) {
      try {
        const unlocked = await client.query<{ released: boolean }>(
          'SELECT pg_advisory_unlock(hashtextextended($1,0)) AS released',
          [lockKey]
        );
        if (unlocked.rows[0]?.released !== true)
          releaseError = new Error('Multipart lock was not held');
      } catch (error) {
        releaseError = error instanceof Error ? error : new Error('Multipart lock release failed');
      }
    }
    if (ownsClient) client.release(releaseError);
  }
  if (!ownsClient && releaseError) throw releaseError;
  return { acquired: true, value };
}

/** Finalize only the committed intent, with its cleanup receipt in the same short transaction. */
export async function finishMultipartReservation(
  client: PoolClient,
  key: string,
  providerId: string,
  status: 'completed' | 'aborted'
): Promise<boolean> {
  const pending = status === 'completed' ? 'completing' : 'aborting';
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE storage_records SET metadata=jsonb_set(metadata,'{multipart}',
         ((metadata->'multipart')||jsonb_build_object('status',$3::text,'resolvedAt',clock_timestamp()))
           -'lastErrorCode') || CASE WHEN metadata->>'provisionalUpload'='true'
             THEN '{"deletionRequested":true}'::jsonb ELSE '{}'::jsonb END,updated_at=NOW()
       WHERE storage_key=$1 AND status='removed' AND signed_at IS NULL
         AND metadata->'multipart'->>'providerId'=$2
         AND metadata->'multipart'->>'status' IN ($3,$4)`,
      [key, providerId, status, pending]
    );
    if (status === 'aborted')
      await client.query(
        `UPDATE upload_cleanup_log SET status='aborted',error_code=NULL,recorded_at=NOW()
         WHERE storage_key=$1 AND provider_upload_id=$2`,
        [key, providerId]
      );
    await client.query('COMMIT');
    return result.rowCount === 1;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}
