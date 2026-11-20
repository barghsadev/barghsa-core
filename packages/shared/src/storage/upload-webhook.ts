import { z } from 'zod';
import { environmentStorageConfig, storedStorageConfig } from './runtime-config.js';

export const STORAGE_UPLOAD_WEBHOOK_BODY_LIMIT = 512;
export const STORAGE_UPLOAD_WEBHOOK_PATH = '/api/webhooks/storage/seaweedfs';

export const storageUploadWebhookEvent = z.strictObject({
  event_type: z.literal('object-created'),
  bucket: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
  key: z
    .string()
    .regex(
      /^uploads\/[a-z][a-z0-9_-]{0,31}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]{1,32})?$/
    ),
  version_id: z.string().regex(/^[0-9a-f]{32}$/),
});

export const storageWebhookReceiptContext = (id: string) => `storage-webhook:${id}`;

export function storageWebhookBucket(stored: unknown | null): string {
  return (stored === null ? environmentStorageConfig() : storedStorageConfig.parse(stored)).bucket;
}
