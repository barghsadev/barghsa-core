import { ConflictException, NotFoundException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import type { CreateRecordOptions } from '@barghsa/shared/storage';

/** Commit ownership and cleanup intent before handing an upload URL to the browser. */
export async function reserveUpload(options: {
  key: string;
  userId: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  category: string;
  expiresIn: number;
}) {
  await getDbPool().query(
    `INSERT INTO storage_records
    (storage_key,status,file_name,content_type,file_size,category,metadata,removed_at)
    VALUES ($1,'removed',$2,$3,$4,$5,jsonb_build_object(
      'uploadedBy',$6::text,'provisionalUpload',true,'deletionRequested',true,
      'uploadExpiresAt',clock_timestamp()+($7::int * INTERVAL '1 second')),NOW())`,
    [
      options.key,
      options.fileName,
      options.contentType,
      options.fileSize,
      options.category,
      options.userId,
      options.expiresIn,
    ]
  );
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
       AND (metadata->>'uploadExpiresAt')::timestamptz>clock_timestamp()))`,
      [key, userId]
    )
  ).rows[0];
  if (!row) throw new NotFoundException('Upload not found or expired');
  return row;
}
/** Conditional promotion cannot revive a removed/expired upload or one already cleaned by a worker. */
export async function completeUpload(options: CreateRecordOptions) {
  const result = await getDbPool().query(
    `UPDATE storage_records SET status='active',
    content_type=$3,file_size=$4,removed_at=NULL,updated_at=NOW(),
    metadata=(metadata-'provisionalUpload'-'deletionRequested'-'uploadExpiresAt')||$5::jsonb
    WHERE storage_key=$1 AND metadata->>'uploadedBy'=$2
    AND status='removed' AND signed_at IS NULL
    AND metadata->>'provisionalUpload'='true' AND metadata->>'deletionRequested'='true'
    AND (metadata->>'uploadExpiresAt')::timestamptz>clock_timestamp()`,
    [
      options.storageKey,
      options.metadata?.uploadedBy,
      options.contentType,
      options.fileSize,
      JSON.stringify(options.metadata),
    ]
  );
  if (result.rowCount !== 1)
    throw new ConflictException('Upload expired or changed; request a new upload');
}
