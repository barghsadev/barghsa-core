import type { Pool } from 'pg';
import {
  STORAGE_UPLOAD_SCAN_JOB_TYPE,
  scanUploadWithClamAv,
  type ScannerEndpoint,
  type StorageProvider,
} from '@barghsa/shared/storage';
import type { JobContext } from '../jobs/async-runner.js';

interface ScanSource {
  inspection: { contentLength?: number; etag?: string; versionId?: string };
  scan_state: string;
  scan_sha256: string | null;
}

export async function scanStoredUpload(
  pool: Pick<Pool, 'query'>,
  storage: StorageProvider | null,
  endpoint: ScannerEndpoint,
  payload: unknown,
  context: JobContext
): Promise<void> {
  const key = (payload as { key?: unknown } | null)?.key;
  if (!storage || typeof key !== 'string' || !/^uploads\/[^/]+\/[^/]+$/.test(key))
    throw new Error('Upload scan source is unavailable');
  const parameters = [key, context.jobId, context.leaseToken, STORAGE_UPLOAD_SCAN_JOB_TYPE];
  const source = (
    await pool.query<ScanSource>(
      `SELECT s.metadata->'storageInspection' AS inspection,s.metadata->>'scanState' AS scan_state,
          s.metadata->>'scanSha256' AS scan_sha256
       FROM storage_records s JOIN async_jobs j ON j.id=$2 AND j.type=$4
          AND j.lease_token=$3 AND j.status='processing' AND j.lease_until>clock_timestamp()
          AND s.metadata->>'uploadedBy'=j.created_by AND s.metadata->>'scanJobId'=j.id::text
       WHERE s.storage_key=$1 AND s.signed_at IS NULL AND (s.status='active' OR
         (s.status='removed' AND s.metadata->>'provisionalUpload'='true'
          AND s.metadata->>'deletionRequested'='true'
          AND COALESCE(s.metadata->'multipart'->>'status','completed') IN ('in_progress','completed')
          AND (s.metadata->>'uploadExpiresAt')::timestamptz>clock_timestamp()))`,
      parameters
    )
  ).rows[0];
  if (!source) throw new Error('Upload scan reservation expired or changed');
  if (source.scan_sha256 && ['Available', 'Quarantined'].includes(source.scan_state)) return;
  const { contentLength, etag, versionId } = source.inspection ?? {};
  if (source.scan_state !== 'Pending scan' || !contentLength || (!etag && !versionId))
    throw new Error('Upload scan is missing object identity');
  const object = await storage.getObject(key);
  if (
    object.contentLength !== contentLength ||
    object.etag !== etag ||
    object.versionId !== versionId
  ) {
    await object.body.cancel();
    throw new Error('Upload scan object changed');
  }
  const { verdict, sha256 } = await scanUploadWithClamAv(object.body, contentLength, endpoint);
  const result = await pool.query(
    `WITH lease AS MATERIALIZED (
       SELECT id,created_by FROM async_jobs WHERE id=$2 AND lease_token=$3 AND type=$4
         AND status='processing' AND lease_until>clock_timestamp() FOR SHARE
     )
     UPDATE storage_records s SET metadata=s.metadata||jsonb_build_object(
       'scanState',$5::text,'scanSha256',$6::text,'scanResolvedAt',clock_timestamp()),updated_at=NOW()
     FROM lease WHERE s.storage_key=$1 AND s.signed_at IS NULL AND s.metadata->>'uploadedBy'=lease.created_by
       AND s.metadata->>'scanJobId'=lease.id::text AND s.metadata->>'scanState'='Pending scan'
       AND s.metadata->'storageInspection'=$7::jsonb AND (s.status='active' OR
         (s.status='removed' AND s.metadata->>'provisionalUpload'='true'
          AND s.metadata->>'deletionRequested'='true'
          AND COALESCE(s.metadata->'multipart'->>'status','completed') IN ('in_progress','completed')
          AND (s.metadata->>'uploadExpiresAt')::timestamptz>clock_timestamp()))`,
    [
      ...parameters,
      verdict === 'clean' ? 'Available' : 'Quarantined',
      sha256,
      JSON.stringify(source.inspection),
    ]
  );
  if (result.rowCount !== 1) throw new Error('Upload scan lease or object changed');
}
