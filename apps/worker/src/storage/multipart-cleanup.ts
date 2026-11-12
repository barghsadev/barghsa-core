import type { Pool } from 'pg';
import { finishMultipartReservation, withMultipartUploadLock } from '@barghsa/db/storage-multipart';
import {
  DEFAULT_MULTIPART_CLEANUP_HOURS,
  MULTIPART_CLEANUP_POLICY_KEY,
  multipartCleanupPolicy,
  type MultipartUploadSummary,
  type StorageProvider,
} from '@barghsa/shared/storage';
import { recoverMultipartOperations } from './multipart-recovery.js';

const cursorKey = 'storage.multipart_cleanup_cursor';
const pageSize = 100;
const scanLimit = 500;
const abortLimit = 25;

type Cursor = { keyMarker?: string; uploadIdMarker?: string };

async function abortOrphanUpload(
  pool: Pool,
  storage: StorageProvider,
  upload: MultipartUploadSummary
) {
  const locked = await withMultipartUploadLock(pool, upload.key, async (client) => {
    try {
      await client.query('BEGIN');
      const record = (
        await client.query<{
          status: string;
          signed_at: Date | null;
          metadata: { multipart?: { providerId?: string; status: string } };
        }>(
          'SELECT status,signed_at,metadata FROM storage_records WHERE storage_key=$1 FOR UPDATE',
          [upload.key]
        )
      ).rows[0];
      const sameUpload = record?.metadata?.multipart?.providerId === upload.uploadId;
      if (
        record &&
        (record.status !== 'removed' ||
          record.signed_at ||
          (sameUpload &&
            !['in_progress', 'aborting', 'aborted'].includes(record.metadata.multipart!.status)))
      ) {
        await client.query('COMMIT');
        return 'skipped' as const;
      }
      await client.query(
        `INSERT INTO upload_cleanup_log(storage_key,provider_upload_id,initiated_at,status,error_code)
         VALUES($1,$2,$3,'pending',NULL)
         ON CONFLICT(storage_key,provider_upload_id) DO UPDATE SET
           status='pending',error_code=NULL,recorded_at=NOW()`,
        [upload.key, upload.uploadId, upload.initiatedAt]
      );
      if (sameUpload && record?.metadata.multipart?.status === 'in_progress')
        await client.query(
          `UPDATE storage_records SET metadata=jsonb_set(metadata,'{multipart,status}',
             '"aborting"'::jsonb),updated_at=NOW() WHERE storage_key=$1`,
          [upload.key]
        );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
    try {
      await storage.abortMultipartUpload!(upload.key, upload.uploadId);
    } catch {
      await client.query(
        `UPDATE upload_cleanup_log SET status='failed',error_code='provider_abort_failed',
           recorded_at=NOW() WHERE storage_key=$1 AND provider_upload_id=$2`,
        [upload.key, upload.uploadId]
      );
      return 'failed' as const;
    }
    await finishMultipartReservation(client, upload.key, upload.uploadId, 'aborted');
    return 'aborted' as const;
  });
  return locked.acquired ? locked.value : 'busy';
}

/** Scan provider-owned in-progress uploads; never infer orphan state from DB rows alone. */
export async function cleanupMultipartOrphans(
  pool: Pool,
  storage: StorageProvider | null,
  now = new Date()
) {
  if (!storage?.listMultipartUploads || !storage.abortMultipartUpload)
    throw new Error('Multipart cleanup requires a version-aware storage provider');
  const client = await pool.connect();
  let acquired = false;
  let releaseError: Error | undefined;
  try {
    acquired =
      (
        await client.query<{ acquired: boolean }>(
          "SELECT pg_try_advisory_lock(hashtext('storage.multipart_orphan_cleanup')) AS acquired"
        )
      ).rows[0]?.acquired === true;
    if (!acquired) return { scanned: 0, aborted: 0, failed: 0, busy: true };
    const policy = (
      await client.query<{ value: unknown }>('SELECT value FROM app_config WHERE key=$1', [
        MULTIPART_CLEANUP_POLICY_KEY,
      ])
    ).rows[0];
    const parsed = multipartCleanupPolicy.safeParse(
      policy ? policy.value : { hours: DEFAULT_MULTIPART_CLEANUP_HOURS }
    );
    if (!parsed.success) throw new Error('Invalid multipart orphan cleanup policy');
    const { hours } = parsed.data;
    const stored = (
      await client.query<{ value: Cursor }>('SELECT value FROM app_config WHERE key=$1', [
        cursorKey,
      ])
    ).rows[0]?.value;
    let keyMarker = stored?.keyMarker;
    let uploadIdMarker = stored?.uploadIdMarker;
    const seenCursors = new Set([JSON.stringify([keyMarker, uploadIdMarker])]);
    const recovered = await recoverMultipartOperations(pool, storage);
    const result: {
      scanned: number;
      aborted: number;
      completed?: number;
      failed: number;
      busy: boolean;
    } = {
      scanned: 0,
      aborted: recovered.aborted,
      failed: recovered.failed,
      busy: false,
    };
    if (recovered.completed) result.completed = recovered.completed;
    const attempted = recovered.attempted;
    const retry = await client.query<{
      storage_key: string;
      provider_upload_id: string;
      initiated_at: Date;
    }>(
      `SELECT l.storage_key,l.provider_upload_id,l.initiated_at FROM upload_cleanup_log l
       WHERE l.status IN ('pending','failed') AND l.recorded_at<=$1::timestamptz-INTERVAL '1 minute'
         AND NOT EXISTS (
           SELECT 1 FROM storage_records s WHERE s.storage_key=l.storage_key
             AND (s.status<>'removed' OR s.signed_at IS NOT NULL OR
               (s.metadata->'multipart'->>'providerId'=l.provider_upload_id
                 AND COALESCE(s.metadata->'multipart'->>'status','')
                   NOT IN ('in_progress','aborting','aborted')))
         )
       ORDER BY l.recorded_at,l.storage_key,l.provider_upload_id LIMIT 25`,
      [now]
    );
    for (const row of retry.rows) {
      if (result.aborted + result.failed >= abortLimit) break;
      const identity = JSON.stringify([row.storage_key, row.provider_upload_id]);
      if (attempted.has(identity)) continue;
      const status = await abortOrphanUpload(pool, storage, {
        key: row.storage_key,
        uploadId: row.provider_upload_id,
        initiatedAt: row.initiated_at,
      });
      attempted.add(identity);
      if (status === 'aborted') result.aborted++;
      if (status === 'failed') result.failed++;
    }
    let reachedEnd = false;
    let pages = 0;
    while (
      result.scanned < scanLimit &&
      result.aborted + result.failed < abortLimit &&
      pages++ < Math.ceil(scanLimit / pageSize)
    ) {
      const page = await storage.listMultipartUploads('', pageSize, keyMarker, uploadIdMarker);
      for (const upload of page.uploads) {
        keyMarker = upload.key;
        uploadIdMarker = upload.uploadId;
        result.scanned++;
        if (now.getTime() - upload.initiatedAt.getTime() < hours * 3600_000) continue;
        if (attempted.has(JSON.stringify([upload.key, upload.uploadId]))) continue;
        const status = await abortOrphanUpload(pool, storage, upload);
        if (status === 'failed') result.failed++;
        if (status === 'aborted') result.aborted++;
        if (result.scanned >= scanLimit || result.aborted + result.failed >= abortLimit) break;
      }
      if (result.scanned >= scanLimit || result.aborted + result.failed >= abortLimit) break;
      if (!page.isTruncated) {
        reachedEnd = true;
        break;
      }
      if (!page.nextKeyMarker || !page.nextUploadIdMarker)
        throw new Error('Multipart upload listing did not provide a continuation cursor');
      const nextCursor = JSON.stringify([page.nextKeyMarker, page.nextUploadIdMarker]);
      if (seenCursors.has(nextCursor))
        throw new Error('Multipart upload listing did not advance its continuation cursor');
      seenCursors.add(nextCursor);
      keyMarker = page.nextKeyMarker;
      uploadIdMarker = page.nextUploadIdMarker;
    }
    await client.query(
      `INSERT INTO app_config(key,value,version) VALUES($1,$2::jsonb,1)
       ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,
         version=app_config.version+1,updated_at=NOW()`,
      [cursorKey, JSON.stringify(reachedEnd ? {} : { keyMarker, uploadIdMarker })]
    );
    return result;
  } finally {
    if (acquired) {
      try {
        await client.query(
          "SELECT pg_advisory_unlock(hashtext('storage.multipart_orphan_cleanup'))"
        );
      } catch (error) {
        releaseError =
          error instanceof Error ? error : new Error('Multipart cleanup lock release failed');
      }
    }
    client.release(releaseError);
  }
}
