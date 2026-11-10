import { ConflictException, NotFoundException } from '@nestjs/common';
import { createDirectDbPool, getDbPool } from '@barghsa/db';
import { storageUploadProfileScope } from '@barghsa/db/schema/storage-record';
import { STORAGE_UPLOAD_SCAN_JOB_TYPE, type CreateRecordOptions } from '@barghsa/shared/storage';
import { v5 as uuidv5 } from 'uuid';
import type { PoolClient } from 'pg';
import type { UploadContext } from './upload.types.js';
import type { OperatingContext } from '../session/session.service.js';
import { checkUploadCapacity, withUploadScope } from './upload-quota.js';

/** Commit ownership and cleanup intent before handing an upload URL to the browser. */
export async function reserveUpload(options: {
  key: string;
  userId: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  category: string;
  expiresIn: number;
  context?: UploadContext & { operatingContext?: OperatingContext };
  independent?: boolean;
}) {
  const insert = (connection: Pick<PoolClient, 'query'>) =>
    connection.query(
      `INSERT INTO storage_records
    (storage_key,status,file_name,content_type,file_size,category,metadata,removed_at)
    VALUES ($1,'removed',$2,$3,$4,$5,jsonb_build_object(
      'uploadedBy',$6::text,'provisionalUpload',true,'deletionRequested',true,'scanState','Uploading',
      'uploadExpiresAt',clock_timestamp()+($7::int * INTERVAL '1 second'),'uploadContext',$8::jsonb),NOW())`,
      [
        options.key,
        options.fileName,
        options.contentType,
        options.fileSize,
        options.category,
        options.userId,
        options.expiresIn,
        JSON.stringify(options.context ?? {}),
      ]
    );
  if (!options.independent) {
    const scope = { userId: options.userId, profileId: options.context?.profileId };
    await withUploadScope(scope, async (client) => {
      await checkUploadCapacity(client, scope, options.fileSize);
      await insert(client);
    });
    return;
  }
  // Internal document generation may run inside a larger business transaction.
  const pool = createDirectDbPool({ poolMax: 1, poolMin: 0 }, { shared: false });
  try {
    await insert(pool);
  } finally {
    await pool.end();
  }
}

/** Older clients may supply the authorized profile at record time instead of presign time. */
export async function bindUploadProfile(key: string, userId: string, profileId: string) {
  const scope = { userId, profileId };
  await withUploadScope(scope, async (client) => {
    const {
      rows: [row],
    } = await client.query<{
      profile_id: string | null;
      file_size: string;
      scan_job_id: string | null;
    }>(
      `SELECT ${storageUploadProfileScope} AS profile_id,file_size,metadata->>'scanJobId' AS scan_job_id
       FROM storage_records WHERE storage_key=$1 AND metadata->>'uploadedBy'=$2
       AND status='removed' AND signed_at IS NULL AND metadata->>'provisionalUpload'='true'
       AND metadata->>'deletionRequested'='true'
       AND metadata->'multipart'->>'status' IS DISTINCT FROM 'aborted'
       AND (metadata->>'uploadExpiresAt')::timestamptz>clock_timestamp()
       FOR UPDATE`,
      [key, userId]
    );
    if (row?.profile_id === profileId.toLowerCase()) return;
    if (!row || row.profile_id || row.scan_job_id)
      throw new ConflictException('Upload changed; request a new upload');
    await checkUploadCapacity(client, scope, Number(row.file_size), key);
    await client.query(
      `UPDATE storage_records SET metadata=metadata||jsonb_build_object('uploadContext',
       COALESCE(metadata->'uploadContext','{}'::jsonb)||jsonb_build_object('profileId',$2::text)),
       updated_at=NOW() WHERE storage_key=$1`,
      [key, profileId]
    );
  });
}
export async function requireOwnedUpload(key: string, userId: string) {
  const row = (
    await getDbPool().query<{
      status: string;
      file_size: string;
      content_type: string;
      metadata: Record<string, unknown>;
    }>(
      `SELECT status,file_size,content_type,metadata FROM storage_records WHERE storage_key=$1
    AND metadata->>'uploadedBy'=$2 AND (status='active' OR
      (status='removed' AND metadata->>'provisionalUpload'='true'
       AND metadata->>'deletionRequested'='true'
       AND metadata->'multipart'->>'status' IS DISTINCT FROM 'aborted'
       AND (metadata->>'uploadExpiresAt')::timestamptz>clock_timestamp()))`,
      [key, userId]
    )
  ).rows[0];
  if (!row) throw new NotFoundException('Upload not found or expired');
  return row;
}

/** Persist the content-inspected object and Pending scan transition, without claiming a scan. */
export async function recordUploadInspection(
  key: string,
  userId: string,
  metadata: {
    contentType: string;
    contentLength: number;
    etag?: string | undefined;
    versionId?: string | undefined;
  }
) {
  const result = await getDbPool().query(
    `UPDATE storage_records SET metadata=metadata||jsonb_build_object(
      'scanState','Pending scan','scanRequestedAt',COALESCE(metadata->'scanRequestedAt',to_jsonb(clock_timestamp())),
      'storageInspection',$3::jsonb),updated_at=NOW()
     WHERE storage_key=$1 AND metadata->>'uploadedBy'=$2 AND status='removed'
       AND signed_at IS NULL AND metadata->>'scanJobId' IS NULL
       AND metadata->>'provisionalUpload'='true'
       AND metadata->>'deletionRequested'='true'
       AND metadata->'multipart'->>'status' IS DISTINCT FROM 'aborted'
       AND (metadata->>'uploadExpiresAt')::timestamptz>clock_timestamp()`,
    [key, userId, JSON.stringify(metadata)]
  );
  if (result.rowCount === 1) return;
  // Concurrent recording is idempotent; removed or expired records cannot be revived.
  const current = await getDbPool().query(
    `SELECT storage_key FROM storage_records WHERE storage_key=$1 AND metadata->>'uploadedBy'=$2
     AND (status='active' OR (status='removed' AND metadata->>'scanJobId' IS NOT NULL
       AND metadata->>'provisionalUpload'='true' AND metadata->>'deletionRequested'='true'
       AND metadata->'multipart'->>'status' IS DISTINCT FROM 'aborted'
       AND (metadata->>'uploadExpiresAt')::timestamptz>clock_timestamp()))`,
    [key, userId]
  );
  if (!current.rows.length) throw new ConflictException('Upload changed; request a new upload');
}

export async function queueUploadScan(input: {
  key: string;
  userId: string;
  operatingContext: OperatingContext;
  context: UploadContext;
  inspection: { contentLength: number; etag: string | undefined; versionId: string | undefined };
}): Promise<string> {
  const id = uuidv5(`barghsa:storage-upload-scan:${input.key}`, uuidv5.URL);
  const result = await getDbPool().query(
    `WITH source AS MATERIALIZED (
       SELECT storage_key FROM storage_records WHERE storage_key=$1 AND metadata->>'uploadedBy'=$2
         AND ${storageUploadProfileScope} IS NOT DISTINCT FROM lower($8::text)
         AND signed_at IS NULL AND metadata->>'scanJobId' IS NULL AND (status='active' OR
           (status='removed' AND metadata->>'provisionalUpload'='true'
            AND metadata->>'deletionRequested'='true'
            AND metadata->'multipart'->>'status' IS DISTINCT FROM 'aborted'
            AND (metadata->>'uploadExpiresAt')::timestamptz>clock_timestamp())) FOR UPDATE
     ), created AS (
       INSERT INTO async_jobs(id,type,payload,created_by,operating_context)
       SELECT $3::uuid,$4,jsonb_build_object('key',$1::text),$2,$5 FROM source
       ON CONFLICT (id) DO NOTHING RETURNING id
     )
     UPDATE storage_records s SET metadata=(s.metadata-'scanSkippedReason'-'scanResolvedAt'-'scanSha256')
       ||jsonb_build_object('scanJobId',created.id::text,'scanState','Pending scan',
          'scanRequestedAt',clock_timestamp(),'storageInspection',$6::jsonb,'scanContext',$7::jsonb),updated_at=NOW()
     FROM source,created WHERE s.storage_key=source.storage_key`,
    [
      input.key,
      input.userId,
      id,
      STORAGE_UPLOAD_SCAN_JOB_TYPE,
      input.operatingContext,
      JSON.stringify(input.inspection),
      JSON.stringify(input.context),
      input.context.profileId ?? null,
    ]
  );
  if (result.rowCount === 1) return id;
  const current = await requireOwnedUpload(input.key, input.userId);
  const context = current.metadata.scanContext as UploadContext | undefined;
  if (
    current.metadata.scanJobId !== id ||
    !context ||
    (['purpose', 'profileId', 'ticketId'] as const).some(
      (field) => context[field] !== input.context[field]
    )
  )
    throw new ConflictException('Upload changed; request a new upload');
  return id;
}

/** Conditional promotion cannot revive a removed/expired upload or one already cleaned by a worker. */
export async function completeUpload(options: CreateRecordOptions, scanJobId?: string) {
  const result = await getDbPool().query(
    `UPDATE storage_records SET status='active',
    content_type=$3,file_size=$4,removed_at=NULL,updated_at=NOW(),
    metadata=(metadata-'provisionalUpload'-'deletionRequested'-'uploadExpiresAt')||$5::jsonb
    WHERE storage_key=$1 AND metadata->>'uploadedBy'=$2
    AND ${storageUploadProfileScope} IS NOT DISTINCT FROM lower($7::text)
    AND status='removed' AND signed_at IS NULL
    AND metadata->>'provisionalUpload'='true' AND metadata->>'deletionRequested'='true'
    AND metadata->'multipart'->>'status' IS DISTINCT FROM 'aborted'
    AND ($6::text IS NULL OR (metadata->>'scanJobId'=$6 AND metadata->>'scanState'='Available'
      AND metadata->>'scanSha256' ~ '^[a-f0-9]{64}$'))
    AND (metadata->>'uploadExpiresAt')::timestamptz>clock_timestamp()`,
    [
      options.storageKey,
      options.metadata?.uploadedBy,
      options.contentType,
      options.fileSize,
      JSON.stringify(options.metadata),
      scanJobId ?? null,
      options.metadata?.profileId ?? null,
    ]
  );
  if (result.rowCount !== 1)
    throw new ConflictException('Upload expired or changed; request a new upload');
}
