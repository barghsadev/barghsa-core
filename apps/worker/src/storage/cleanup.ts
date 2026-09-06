import { loadStoredStorageConfiguration } from '@barghsa/db';
import type { Pool } from 'pg';
import { runtimeStorageProvider, type StorageProvider } from '@barghsa/shared/storage';

export function cleanupStorageProvider(): StorageProvider {
  return runtimeStorageProvider(loadStoredStorageConfiguration);
}
const pending = `status='removed' AND signed_at IS NULL AND metadata->>'deletionRequested'='true'
  AND (storage_key NOT LIKE 'uploads/%' OR removed_at<=NOW()-INTERVAL '65 minutes')
  AND updated_at<=NOW()-INTERVAL '1 minute'`;

/** Only explicit, committed deletion requests are eligible; legacy and signed records are retained. */
export async function cleanupStorageObjects(pool: Pool, storage: StorageProvider | null) {
  const candidates = (
    await pool.query<{ storage_key: string }>(`SELECT storage_key FROM storage_records
    WHERE ${pending} ORDER BY updated_at,storage_key LIMIT 25`)
  ).rows;
  const result = { deleted: 0, failed: 0 };
  if (!candidates.length) return result;
  if (!storage) throw new Error('Storage cleanup is configured without an available provider');
  for (const candidate of candidates) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query(
        `SELECT storage_key FROM storage_records WHERE storage_key=$1 AND ${pending} FOR UPDATE SKIP LOCKED`,
        [candidate.storage_key]
      );
      if (!found.rows.length) {
        await client.query('ROLLBACK');
        continue;
      }
      await storage.deleteObject(candidate.storage_key);
      await client.query(
        `UPDATE storage_records SET metadata=metadata||jsonb_build_object('deletionRequested',false,'deletionCompletedAt',NOW()),updated_at=NOW() WHERE storage_key=$1`,
        [candidate.storage_key]
      );
      await client.query('COMMIT');
      result.deleted++;
    } catch {
      await client.query('ROLLBACK');
      // Back off after transport/commit failure; deleting an already absent object is idempotent.
      await client.query(
        `UPDATE storage_records SET updated_at=NOW() WHERE storage_key=$1
        AND status='removed' AND signed_at IS NULL AND metadata->>'deletionRequested'='true'`,
        [candidate.storage_key]
      );
      result.failed++;
    } finally {
      client.release();
    }
  }
  return result;
}
