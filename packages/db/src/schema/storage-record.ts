import { sql } from 'drizzle-orm';
import { bigint, check, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { baseColumns } from '../base-table';
import { domainChecks } from '../domain-checks';

/**
 * Storage record status.
 *
 * - `active` — the object is live and deletable.
 * - `immutable` — the object has been signed/approved and cannot be
 *   physically deleted. Any delete attempt becomes a soft-delete.
 * - `removed` — soft-deleted: the DB record is marked as removed but
 *   the underlying S3 object is retained (versioning preserves history).
 *   A future lifecycle policy can expire `removed` records after a
 *   configurable retention period.
 */
export const storageRecordStatus = ['active', 'immutable', 'removed'] as const;
export type StorageRecordStatus = (typeof storageRecordStatus)[number];

/** Scope a stored object even when it predates the current upload context. */
export const storageUploadProfileScope = `lower(COALESCE(
  metadata->'uploadContext'->>'profileId',
  metadata->>'profileId',
  metadata->'scanContext'->>'profileId'
))`;

/**
 * Storage records table.
 *
 * Tracks every stored object's lifecycle status for immutability
 * enforcement. When a record is `immutable`, the storage layer
 * prevents `deleteObject` for that key — instead performing a soft
 * delete (marking the record as `removed` in PostgreSQL while
 * retaining the object in S3).
 *
 * S3 versioning ensures that even if the object is accidentally
 * overwritten, previous versions are preserved.
 */
export const storageRecords = pgTable(
  'storage_records',
  {
    ...baseColumns,
    /** The S3 storage key. Unique across all records. */
    storageKey: text('storage_key').notNull().unique(),

    /** Original file name, if known. */
    fileName: text('file_name'),

    /** MIME content type. */
    contentType: text('content_type'),

    /** File size in bytes. */
    fileSize: bigint('file_size', { mode: 'number' }),

    /** Upload category (e.g. 'contract', 'invoice', 'general'). */
    category: text('category'),

    /** Current lifecycle status. */
    status: text('status', { enum: storageRecordStatus }).notNull().default('active'),

    /** Arbitrary user-defined metadata stored alongside the object. */
    metadata: jsonb('metadata'),

    /** When the record was marked as immutable (signed/approved). */
    signedAt: timestamp('signed_at', { withTimezone: true, mode: 'date' }),

    /** Who marked the record as immutable (user id or system). */
    signedBy: text('signed_by'),

    /** When the record was soft-deleted. */
    removedAt: timestamp('removed_at', { withTimezone: true, mode: 'date' }),

    /** Once claimed for cleanup, this key cannot be promoted or signed. */
    cleanupOperation: text('cleanup_operation', { enum: ['delete', 'expire'] }),
  },
  (table) => [
    ...domainChecks('storage_records'),
    check(
      'storage_records_cleanup_operation_check',
      sql`${table.cleanupOperation} IS NULL OR
        (${table.cleanupOperation} IN ('delete','expire') AND ${table.status}='removed' AND ${table.signedAt} IS NULL)`
    ),
    index('storage_records_multipart_pending_idx').on(table.updatedAt, table.storageKey)
      .where(sql`${table.status}='removed' AND ${table.signedAt} IS NULL
        AND ${table.metadata}->'multipart'->>'status' IN ('completing','aborting')`),
    index('storage_records_upload_profile_idx').on(sql.raw(storageUploadProfileScope)),
    index('storage_records_unscoped_uploader_idx')
      .on(sql`(${table.metadata}->>'uploadedBy')`)
      .where(sql`${sql.raw(storageUploadProfileScope)} IS NULL`),
  ]
);

/**
 * SQL to create the storage_records table.
 */
export const createStorageRecordsTable = sql`
  CREATE TABLE IF NOT EXISTS storage_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    storage_key TEXT NOT NULL UNIQUE,
    file_name TEXT,
    content_type TEXT,
    file_size BIGINT,
    category TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'immutable', 'removed')),
    metadata JSONB,
    signed_at TIMESTAMPTZ,
    signed_by TEXT,
    removed_at TIMESTAMPTZ,
    cleanup_operation TEXT CONSTRAINT storage_records_cleanup_operation_check CHECK (
      cleanup_operation IS NULL OR
      (cleanup_operation IN ('delete','expire') AND status='removed' AND signed_at IS NULL)
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_storage_records_status ON storage_records (status);
  CREATE INDEX IF NOT EXISTS idx_storage_records_category ON storage_records (category);
  CREATE INDEX IF NOT EXISTS storage_records_upload_profile_idx
    ON storage_records (${sql.raw(storageUploadProfileScope)});
  CREATE INDEX IF NOT EXISTS storage_records_unscoped_uploader_idx
    ON storage_records ((metadata->>'uploadedBy')) WHERE ${sql.raw(storageUploadProfileScope)} IS NULL;
`;
