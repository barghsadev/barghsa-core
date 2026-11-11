import type { Pool } from 'pg';
import { finishMultipartReservation, withMultipartUploadLock } from '@barghsa/db/storage-multipart';
import {
  finishMultipartUpload,
  validMultipartParts,
  type MultipartUploadState,
  type MultipartPart,
  type StorageProvider,
} from '@barghsa/shared/storage';

/** Resume committed operations, including responses lost after S3 removed the upload ID. */
export async function recoverMultipartOperations(pool: Pool, storage: StorageProvider) {
  const candidates = await pool.query<{ storage_key: string }>(
    `SELECT storage_key FROM storage_records WHERE status='removed' AND signed_at IS NULL
       AND metadata->'multipart'->>'status' IN ('completing','aborting')
     ORDER BY updated_at,storage_key LIMIT 25`
  );
  const result = { completed: 0, aborted: 0, failed: 0, attempted: new Set<string>() };
  for (const candidate of candidates.rows) {
    await withMultipartUploadLock(pool, candidate.storage_key, async (client) => {
      const row = (
        await client.query<{
          file_size: string;
          metadata: { multipart: MultipartUploadState };
        }>(
          `SELECT file_size,metadata FROM storage_records WHERE storage_key=$1
             AND status='removed' AND signed_at IS NULL
             AND metadata->'multipart'->>'status' IN ('completing','aborting')`,
          [candidate.storage_key]
        )
      ).rows[0];
      if (!row) return;
      const multipart = row.metadata.multipart;
      result.attempted.add(JSON.stringify([candidate.storage_key, multipart.providerId]));
      try {
        if (!multipart.providerId) throw new Error('Multipart provider identity is unavailable');
        if (multipart.status === 'completing') {
          // A browser may have replaced a part through a previously issued URL.
          // Persist the current validated identities before retrying completion.
          let parts: MultipartPart[] | undefined;
          try {
            parts = (
              await storage.listMultipartParts!(candidate.storage_key, multipart.providerId)
            ).sort((a, b) => a.partNumber - b.partNumber);
          } catch {
            // The committed receipt can resolve a lost response while ListParts is unavailable.
          }
          if (parts) {
            if (!validMultipartParts(parts, Number(row.file_size)))
              throw new Error('Multipart parts do not match the reservation');
            const updated = await client.query(
              `UPDATE storage_records SET metadata=jsonb_set(metadata,'{multipart,parts}',$3::jsonb)
               WHERE storage_key=$1 AND metadata->'multipart'->>'providerId'=$2
                 AND status='removed' AND signed_at IS NULL
                 AND metadata->'multipart'->>'status'='completing'`,
              [candidate.storage_key, multipart.providerId, JSON.stringify(parts)]
            );
            if (updated.rowCount !== 1) return;
            multipart.parts = parts;
          }
          await finishMultipartUpload(
            storage,
            candidate.storage_key,
            multipart.providerId,
            multipart.parts,
            Number(row.file_size)
          );
          if (
            await finishMultipartReservation(
              client,
              candidate.storage_key,
              multipart.providerId,
              'completed'
            )
          )
            result.completed++;
        } else {
          if (!storage.abortMultipartUpload) throw new Error('Multipart abort is unavailable');
          await storage.abortMultipartUpload(candidate.storage_key, multipart.providerId);
          if (
            await finishMultipartReservation(
              client,
              candidate.storage_key,
              multipart.providerId,
              'aborted'
            )
          )
            result.aborted++;
        }
      } catch {
        await client.query(
          `UPDATE storage_records SET metadata=jsonb_set(metadata,'{multipart,lastErrorCode}',
             to_jsonb($2::text)),updated_at=NOW()
           WHERE storage_key=$1 AND status='removed' AND signed_at IS NULL
             AND metadata->'multipart'->>'status' IN ('completing','aborting')`,
          [
            candidate.storage_key,
            multipart.status === 'completing'
              ? 'completion_retry_required'
              : 'abort_retry_required',
          ]
        );
        result.failed++;
      }
    });
  }
  return result;
}
