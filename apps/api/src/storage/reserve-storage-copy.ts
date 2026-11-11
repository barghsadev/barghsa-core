import { createDirectDbPool } from '@barghsa/db';
import { withMultipartUploadLock } from '@barghsa/db/storage-multipart';
import type { PoolClient } from 'pg';

/** Commit cleanup intent before writing an object, independently of its business transaction. */
export async function reserveStorageCopy(key: string, metadata: Record<string, unknown>) {
  // An owned connection avoids waiting for another slot in a pool exhausted by
  // business transactions. This insert has no foreign keys or source-row locks.
  const journal = createDirectDbPool({ poolMax: 1, poolMin: 0 }, { shared: false });
  try {
    await journal.query(
      `INSERT INTO storage_records(storage_key,status,metadata,removed_at)
       VALUES ($1,'removed',$2::jsonb,NOW())`,
      [key, JSON.stringify({ ...metadata, provisionalCopy: true, deletionRequested: true })]
    );
  } finally {
    await journal.end();
  }
}

/** Fence cleanup during a provider write without holding a SQL transaction. */
export async function writeProvisionalStorageCopy(
  key: string,
  metadata: Record<string, unknown>,
  write: () => Promise<unknown>,
  directClient?: PoolClient
): Promise<boolean> {
  await reserveStorageCopy(key, metadata);
  const outcome = await withMultipartUploadLock(
    directClient ?? createDirectDbPool(),
    key,
    async (client) => {
      const ready = await client.query(
        `SELECT 1 FROM storage_records WHERE storage_key=$1 AND status='removed'
         AND cleanup_operation IS NULL AND metadata @> $2::jsonb`,
        [key, JSON.stringify({ ...metadata, provisionalCopy: true, deletionRequested: true })]
      );
      if (!ready.rows[0]) return false;
      await write();
      // Give publication a fresh cleanup grace period after a slow provider write.
      const refreshed = await client.query(
        `UPDATE storage_records SET updated_at=NOW() WHERE storage_key=$1
         AND status='removed' AND cleanup_operation IS NULL`,
        [key]
      );
      return refreshed.rowCount === 1;
    }
  );
  return outcome.acquired && outcome.value;
}
