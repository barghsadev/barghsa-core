import type { Pool } from 'pg';
import { SecretCipher } from '@barghsa/shared/auth-delivery';
import {
  runtimeStorageProvider,
  StorageObjectNotFound,
  storageUploadWebhookEvent,
  storageWebhookBucket,
  storageWebhookReceiptContext,
} from '@barghsa/shared/storage';

const pendingReservation = `status='removed' AND cleanup_operation IS NULL AND signed_at IS NULL
  AND metadata->>'provisionalUpload'='true' AND metadata->>'deletionRequested'='true'
  AND NULLIF(metadata->>'uploadedBy', '') IS NOT NULL
  AND (metadata->>'uploadExpiresAt')::timestamptz>clock_timestamp()`;

export async function processStorageWebhookReceipt(pool: Pool): Promise<void> {
  const receipt = (
    await pool.query<{ event_id: string; encrypted_payload: string; attempts: number }>(
      `WITH candidate AS (
         SELECT event_id FROM storage_webhook_events
         WHERE processed_at IS NULL AND available_at <= clock_timestamp()
         ORDER BY available_at, event_id LIMIT 1 FOR UPDATE SKIP LOCKED
       )
       UPDATE storage_webhook_events AS event
       SET attempts = attempts + 1, available_at = clock_timestamp() + interval '2 minutes'
       FROM candidate WHERE event.event_id = candidate.event_id
       RETURNING event.event_id, event.encrypted_payload, event.attempts`
    )
  ).rows[0];
  if (!receipt) return;

  try {
    const body = new SecretCipher('STORAGE_CONFIG_ENCRYPTION_KEY').decrypt(
      receipt.encrypted_payload,
      storageWebhookReceiptContext(receipt.event_id)
    );
    const event = storageUploadWebhookEvent.parse(JSON.parse(body));
    const stored =
      (
        await pool.query<{ value: unknown }>(
          "SELECT value FROM app_config WHERE key='storage.active'"
        )
      ).rows[0]?.value ?? null;
    const reservation =
      event.bucket === storageWebhookBucket(stored)
        ? (
            await pool.query<{ file_size: string; content_type: string; multipart_status: string }>(
              `SELECT file_size, content_type,
                    COALESCE(metadata->'multipart'->>'status', 'completed') AS multipart_status
             FROM storage_records
             WHERE storage_key = $1 AND ${pendingReservation}`,
              [event.key]
            )
          ).rows[0]
        : undefined;

    if (reservation?.multipart_status === 'completing')
      throw new Error('Upload completion is still being recorded');
    let observed = false;
    if (reservation?.multipart_status === 'completed') {
      const storage = runtimeStorageProvider(async () => stored);
      try {
        const object = await storage.getObject(event.key);
        await object.body.cancel().catch(() => undefined);
        observed =
          object.versionId === event.version_id &&
          object.contentLength === Number(reservation.file_size) &&
          object.contentType === reservation.content_type;
      } catch (cause) {
        if (!(cause instanceof StorageObjectNotFound)) throw cause;
      } finally {
        storage.destroy?.();
      }
    }

    // Only the current claim can update a still-pending reservation. This is
    // an observation. Verification, scanning and sealing retain their gates.
    await pool.query(
      `WITH claim AS (
         SELECT event_id FROM storage_webhook_events
         WHERE event_id = $1 AND attempts = $2 AND processed_at IS NULL FOR UPDATE
       ), matched AS (
         UPDATE storage_records
         SET metadata = metadata || jsonb_build_object('providerObservedVersion', $4::text),
             updated_at = clock_timestamp()
         WHERE EXISTS(SELECT 1 FROM claim) AND $5::boolean AND storage_key = $3
           AND ${pendingReservation}
           AND COALESCE(metadata->'multipart'->>'status', 'completed') = 'completed'
           AND (SELECT value FROM app_config WHERE key='storage.active') IS NOT DISTINCT FROM $6::jsonb
         RETURNING storage_key
       )
       UPDATE storage_webhook_events
       SET processed_at = clock_timestamp(),
           outcome = CASE WHEN EXISTS(SELECT 1 FROM matched) THEN 'observed' ELSE 'ignored' END
       WHERE event_id IN (SELECT event_id FROM claim)`,
      [receipt.event_id, receipt.attempts, event.key, event.version_id, observed, stored]
    );
  } catch (cause) {
    await pool.query(
      `UPDATE storage_webhook_events SET available_at = clock_timestamp() + interval '30 seconds'
       WHERE event_id = $1 AND attempts = $2 AND processed_at IS NULL`,
      [receipt.event_id, receipt.attempts]
    );
    throw new Error('Storage webhook receipt processing will retry', { cause });
  }
}
