import type { Pool, PoolClient } from 'pg';

/** Call with a direct/session pool. Transaction-pooled connections cannot own this lock. */
export async function withMultipartUploadLock<T>(
  pool: Pool,
  key: string,
  work: (client: PoolClient) => Promise<T>
): Promise<{ acquired: false } | { acquired: true; value: T }> {
  const client = await pool.connect();
  const lockKey = `storage:multipart:${key}`;
  let locked = false;
  let releaseError: Error | undefined;
  try {
    locked =
      (
        await client.query<{ acquired: boolean }>(
          'SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired',
          [lockKey]
        )
      ).rows[0]?.acquired === true;
    if (!locked) return { acquired: false };
    return { acquired: true, value: await work(client) };
  } finally {
    if (locked) {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lockKey]);
      } catch (error) {
        releaseError = error instanceof Error ? error : new Error('Multipart lock release failed');
      }
    }
    client.release(releaseError);
  }
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
