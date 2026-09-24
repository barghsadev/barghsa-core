import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { uuidv7 } from '../types';

/** Durable outcome for each incomplete provider upload classified by the worker. */
export const uploadCleanupLog = pgTable(
  'upload_cleanup_log',
  {
    id: uuidv7('id').primaryKey().notNull(),
    storageKey: text('storage_key').notNull(),
    providerUploadId: text('provider_upload_id').notNull(),
    initiatedAt: timestamp('initiated_at', { withTimezone: true, mode: 'date' }).notNull(),
    status: text('status', { enum: ['aborted', 'failed'] }).notNull(),
    errorCode: text('error_code'),
    recordedAt: timestamp('recorded_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('upload_cleanup_upload_unique').on(table.storageKey, table.providerUploadId),
    index('upload_cleanup_recorded_idx').on(table.recordedAt),
    check('upload_cleanup_status', sql`${table.status} IN ('aborted','failed')`),
  ]
);

export type UploadCleanupLog = typeof uploadCleanupLog.$inferSelect;
