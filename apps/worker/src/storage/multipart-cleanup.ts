import type { Pool } from 'pg';
import type { StorageProvider } from '@barghsa/shared/storage';

const policyKey = 'storage.multipart_orphan_hours';
const cursorKey = 'storage.multipart_cleanup_cursor';
const pageSize = 100;
const scanLimit = 500;
const abortLimit = 25;

type Cursor = { keyMarker?: string; uploadIdMarker?: string };

/** Scan provider-owned in-progress uploads; never infer orphan state from DB rows alone. */
export async function cleanupMultipartOrphans(
  pool: Pool,
  storage: StorageProvider | null,
  now = new Date()
) {
  if (!storage?.listMultipartUploads || !storage.abortMultipartUpload)
    throw new Error('Multipart cleanup requires a version-aware storage provider');
  const client = await pool.connect();
  try {
    const acquired = (
      await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock(hashtext('storage.multipart_orphan_cleanup')) AS acquired"
      )
    ).rows[0]?.acquired;
    if (!acquired) return { scanned: 0, aborted: 0, failed: 0, busy: true };
    const policy = (
      await client.query<{ value: { hours?: number } }>(
        'SELECT value FROM app_config WHERE key=$1',
        [policyKey]
      )
    ).rows[0]?.value;
    const hours = policy?.hours ?? 24;
    if (!Number.isInteger(hours) || hours < 1 || hours > 168)
      throw new Error('Invalid multipart orphan cleanup policy');
    const stored = (
      await client.query<{ value: Cursor }>('SELECT value FROM app_config WHERE key=$1', [
        cursorKey,
      ])
    ).rows[0]?.value;
    let keyMarker = stored?.keyMarker;
    let uploadIdMarker = stored?.uploadIdMarker;
    const result = { scanned: 0, aborted: 0, failed: 0, busy: false };
    let reachedEnd = false;
    while (result.scanned < scanLimit && result.aborted + result.failed < abortLimit) {
      const page = await storage.listMultipartUploads('', pageSize, keyMarker, uploadIdMarker);
      for (const upload of page.uploads) {
        keyMarker = upload.key;
        uploadIdMarker = upload.uploadId;
        result.scanned++;
        if (now.getTime() - upload.initiatedAt.getTime() < hours * 3600_000) continue;
        await client.query('BEGIN');
        try {
          const record = (
            await client.query<{
              status: string;
              metadata: { multipart?: { providerId: string; status: string } };
            }>('SELECT status,metadata FROM storage_records WHERE storage_key=$1 FOR UPDATE', [
              upload.key,
            ])
          ).rows[0];
          if (
            record &&
            (record.status !== 'removed' ||
              (record.metadata?.multipart?.providerId === upload.uploadId &&
                record.metadata.multipart.status !== 'in_progress'))
          ) {
            await client.query('COMMIT');
            continue;
          }
          let status: 'aborted' | 'failed' = 'aborted';
          try {
            await storage.abortMultipartUpload(upload.key, upload.uploadId);
          } catch {
            status = 'failed';
          }
          if (status === 'aborted')
            await client.query(
              `UPDATE storage_records SET
                metadata=jsonb_set(metadata,'{multipart,status}','"aborted"'::jsonb)
                  ||jsonb_build_object('uploadExpiresAt',NOW()),
                updated_at=NOW()
               WHERE storage_key=$1 AND status='removed'
                 AND metadata->'multipart'->>'providerId'=$2
                 AND metadata->'multipart'->>'status'='in_progress'`,
              [upload.key, upload.uploadId]
            );
          await client.query(
            `INSERT INTO upload_cleanup_log(storage_key,provider_upload_id,initiated_at,status,error_code)
             VALUES($1,$2,$3,$4,$5)
             ON CONFLICT(storage_key,provider_upload_id) DO UPDATE SET
               status=EXCLUDED.status,error_code=EXCLUDED.error_code,recorded_at=NOW()`,
            [
              upload.key,
              upload.uploadId,
              upload.initiatedAt,
              status,
              status === 'failed' ? 'provider_abort_failed' : null,
            ]
          );
          await client.query('COMMIT');
          if (status === 'failed') result.failed++;
          else result.aborted++;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
        if (result.scanned >= scanLimit || result.aborted + result.failed >= abortLimit) break;
      }
      if (result.scanned >= scanLimit || result.aborted + result.failed >= abortLimit) break;
      if (!page.isTruncated) {
        reachedEnd = true;
        break;
      }
      if (!page.nextKeyMarker || !page.nextUploadIdMarker)
        throw new Error('Multipart upload listing did not provide a continuation cursor');
      if (page.uploads.length === 0) {
        keyMarker = page.nextKeyMarker;
        uploadIdMarker = page.nextUploadIdMarker;
      }
    }
    await client.query(
      `INSERT INTO app_config(key,value,version) VALUES($1,$2::jsonb,1)
       ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,
         version=app_config.version+1,updated_at=NOW()`,
      [cursorKey, JSON.stringify(reachedEnd ? {} : { keyMarker, uploadIdMarker })]
    );
    return result;
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtext('storage.multipart_orphan_cleanup'))")
      .catch(() => {});
    client.release();
  }
}
