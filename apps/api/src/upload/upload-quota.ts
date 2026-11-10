import { HttpException, PayloadTooLargeException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { storageUploadProfileScope } from '@barghsa/db/schema/storage-record';
import { GLOBAL_MAX_UPLOAD_POLICY_SIZE_BYTES } from '@barghsa/shared/admin';
import { ErrorCodes } from '@barghsa/shared/errors';
import type { PoolClient } from 'pg';

const MAX_PENDING_UPLOADS = 20;
const MAX_STORAGE_BYTES = 10n * 1024n ** 3n;

type UploadScope = { profileId?: string | undefined; userId: string };

/** A short transaction serializes admission for one profile across all its authorized actors. */
export async function withUploadScope<T>(
  { profileId, userId }: UploadScope,
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      profileId ? `upload:quota:profile:${profileId.toLowerCase()}` : `upload:quota:user:${userId}`,
    ]);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// Authoritative associations keep pre-profile-metadata records in the profile's usage.
const profileKeys = `
  SELECT storage_key, NULL::bigint AS known_bytes FROM storage_records
    WHERE ${storageUploadProfileScope}=$1::text
  UNION ALL
  SELECT object.key, d.size_bytes FROM documents d
    CROSS JOIN LATERAL (VALUES (d.upload_key),(d.storage_key)) AS object(key)
    WHERE d.profile_id=$1::text::uuid
  UNION ALL
  SELECT attachment_key,NULL::bigint FROM bank_receipts WHERE profile_id=$1::text::uuid
  UNION ALL
  SELECT COALESCE(receipt_attachment_key,metadata#>>'{receipt,attachmentKey}'),NULL::bigint
    FROM wallet_transactions WHERE wallet_id=$1::text::uuid AND type='topup'
  UNION ALL
  SELECT attachment.key,NULL::bigint FROM tickets t
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(t.attachments)='array' THEN t.attachments ELSE '[]'::jsonb END
    ) AS attachment(key)
    WHERE t.profile_id=$1::text::uuid
  UNION ALL
  SELECT attachment.key,NULL::bigint FROM tickets t
    JOIN ticket_comments c ON c.ticket_id=t.id
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(c.attachments)='array' THEN c.attachments ELSE '[]'::jsonb END
    ) AS attachment(key)
    WHERE t.profile_id=$1::text::uuid
`;

/** Run under the destination scope lock before creating or moving a reservation. */
export async function checkUploadCapacity(
  client: PoolClient,
  scope: UploadScope,
  newBytes: number,
  excludeKey?: string
) {
  const keys = scope.profileId
    ? profileKeys
    : `SELECT storage_key, NULL::bigint AS known_bytes FROM storage_records
       WHERE metadata->>'uploadedBy'=$1 AND ${storageUploadProfileScope} IS NULL`;
  const result = await client.query<{
    pending: number;
    bytes: string;
    retry_ms: number | null;
  }>(
    `WITH scoped_keys AS (
       SELECT storage_key,MAX(known_bytes) AS known_bytes FROM (${keys}) found
       WHERE $2::text IS NULL OR storage_key<>$2 GROUP BY storage_key
     ), records AS (
       SELECT COALESCE(s.metadata->>'sourceKey',s.metadata->>'sourceAttachmentKey',s.storage_key)
           AS logical_key,
         CASE WHEN s.file_size>0 THEN s.file_size
           WHEN k.known_bytes>0 THEN k.known_bytes ELSE $3::bigint END AS bytes,
         CASE WHEN s.status='removed' AND s.signed_at IS NULL
           AND s.metadata->>'provisionalUpload'='true' AND s.metadata->>'deletionRequested'='true'
           AND s.metadata->'multipart'->>'status' IS DISTINCT FROM 'aborted'
           THEN (s.metadata->>'uploadExpiresAt')::timestamptz END AS expires,
         s.signed_at IS NOT NULL OR s.status IN ('active','immutable')
           OR (s.metadata->>'provisionalUpload' IS DISTINCT FROM 'true'
             AND s.metadata->>'provisionalCopy' IS DISTINCT FROM 'true'
             AND s.metadata->>'deletionCompletedAt' IS NULL) AS retained
       FROM scoped_keys k JOIN storage_records s USING (storage_key)
     ), logical_uploads AS (
       SELECT MAX(bytes) AS bytes FROM records
       WHERE retained OR expires>statement_timestamp() GROUP BY logical_key
     )
     SELECT COUNT(*) FILTER (WHERE expires>statement_timestamp())::int AS pending,
       COALESCE((SELECT SUM(bytes) FROM logical_uploads),0)::text AS bytes,
       CEIL(EXTRACT(EPOCH FROM (MIN(expires) FILTER (WHERE expires>statement_timestamp())
         -statement_timestamp()))*1000)::int AS retry_ms
     FROM records`,
    [
      scope.profileId?.toLowerCase() ?? scope.userId,
      excludeKey ?? null,
      GLOBAL_MAX_UPLOAD_POLICY_SIZE_BYTES,
    ]
  );
  const usage = result.rows[0]!;
  if (usage.pending >= MAX_PENDING_UPLOADS) {
    throw new HttpException(
      {
        statusCode: 429,
        error: ErrorCodes.RATE_LIMIT_EXCEEDED.code,
        retryAfterMs: usage.retry_ms,
      },
      429
    );
  }
  if (BigInt(usage.bytes) + BigInt(newBytes) > MAX_STORAGE_BYTES)
    throw new PayloadTooLargeException({
      error: ErrorCodes.VALIDATION_PAYLOAD_TOO_LARGE.code,
      message: 'Upload storage quota reached',
    });
}
