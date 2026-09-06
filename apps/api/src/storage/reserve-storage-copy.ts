import { createDirectDbPool } from '@barghsa/db';

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
