import { loadStoredStorageConfiguration } from '@barghsa/db';
import { withMultipartUploadLock } from '@barghsa/db/storage-multipart';
import type { Pool } from 'pg';
import { runtimeStorageProvider, type StorageProvider } from '@barghsa/shared/storage';

export function cleanupStorageProvider(): StorageProvider {
  return runtimeStorageProvider(loadStoredStorageConfiguration);
}

type CleanupOperation = 'delete' | 'expire';
const pending = `status='removed' AND signed_at IS NULL AND metadata->>'deletionRequested'='true'
  AND COALESCE(metadata->'multipart'->>'status','completed') NOT IN ('completing','aborting')
  AND (storage_key NOT LIKE 'uploads/%' OR removed_at<=NOW()-INTERVAL '65 minutes')
  AND (metadata->>'provisionalUpload' IS DISTINCT FROM 'true'
    OR (metadata->>'uploadExpiresAt')::timestamptz<=clock_timestamp())
  AND updated_at<=NOW()-INTERVAL '1 minute'`;

/** Only explicit, committed deletion requests are eligible; legacy and signed records are retained. */
export async function cleanupStorageObjects(pool: Pool, storage: StorageProvider | null) {
  const candidates = (
    await pool.query<{ storage_key: string }>(`SELECT storage_key FROM storage_records
    WHERE ${pending} ORDER BY updated_at,storage_key LIMIT 25`)
  ).rows;
  const result: { deleted: number; failed: number; expirationScheduled?: number } = {
    deleted: 0,
    failed: 0,
  };
  if (!candidates.length) return result;
  if (!storage) throw new Error('Storage cleanup is configured without an available provider');
  for (const { storage_key: key } of candidates) {
    try {
      // The same direct-session lock also serializes multipart provider operations on this key.
      const completed = await withMultipartUploadLock(pool, key, async (client) => {
        const claimed = await client.query<{ cleanup_operation: CleanupOperation }>(
          `WITH eligible AS (
             SELECT storage_key FROM storage_records WHERE storage_key=$1 AND ${pending}
             FOR UPDATE SKIP LOCKED
           )
           UPDATE storage_records s SET cleanup_operation=COALESCE(s.cleanup_operation,
             CASE WHEN s.storage_key LIKE 'uploads/%' AND s.metadata->>'provisionalUpload'='true'
                  THEN 'expire' ELSE 'delete' END),updated_at=NOW()
           FROM eligible WHERE s.storage_key=eligible.storage_key RETURNING s.cleanup_operation`,
          [key]
        );
        const operation = claimed.rows[0]?.cleanup_operation;
        if (!operation) return null;

        // The claim has committed. The database fences promotion while the provider is contacted.
        try {
          let versions: { eligibleVersions: number; heldVersions: number } | undefined;
          if (operation === 'expire') {
            if (!storage.scheduleExpiration) throw new Error('Storage retention is unavailable');
            versions = await storage.scheduleExpiration(key);
          } else {
            await storage.deleteObject(key);
          }
          const receipt = await client.query(
            `UPDATE storage_records SET metadata=metadata||jsonb_build_object('deletionRequested',false)
             || CASE WHEN $2='expire' THEN jsonb_build_object(
                  'expirationScheduledAt',NOW(),'expirationEligibleVersions',$3::int,'retainedHeldVersions',$4::int)
                ELSE jsonb_build_object('deletionCompletedAt',NOW()) END,updated_at=NOW()
             WHERE storage_key=$1 AND cleanup_operation=$2 AND status='removed' AND signed_at IS NULL
               AND metadata->>'deletionRequested'='true'`,
            [key, operation, versions?.eligibleVersions ?? null, versions?.heldVersions ?? null]
          );
          if (receipt.rowCount !== 1) throw new Error('Storage cleanup claim changed');
          return operation;
        } catch (error) {
          // Keep the operation and back off from the last failure, including a lost receipt.
          await client.query(
            `UPDATE storage_records SET updated_at=NOW() WHERE storage_key=$1 AND cleanup_operation=$2
             AND status='removed' AND signed_at IS NULL AND metadata->>'deletionRequested'='true'`,
            [key, operation]
          );
          throw error;
        }
      });
      if (!completed.acquired) continue;
      if (completed.value === 'delete') result.deleted++;
      if (completed.value === 'expire')
        result.expirationScheduled = (result.expirationScheduled ?? 0) + 1;
    } catch {
      result.failed++;
    }
  }
  return result;
}
