/**
 * Db adapter implementation for the storage_records table.
 *
 * Bridges between the {@link ImmutableStorageRecordService} (from
 * @barghsa/shared/storage) and the Drizzle ORM-backed
 * `storage_records` schema.
 */

import { Inject, Injectable, Logger } from '@nestjs/common'
import type { DbInstance } from '@barghsa/db'
import { storageRecords, type StorageRecordStatus } from '@barghsa/db/schema/storage-record'
import { eq, sql } from '@barghsa/db'
import type { DbAdapter } from '@barghsa/shared/storage'

@Injectable()
export class StorageRecordDbAdapter implements DbAdapter {
  private readonly logger = new Logger(StorageRecordDbAdapter.name)

  constructor(@Inject('DB_INSTANCE') private readonly db: DbInstance) {}

  async createStorageRecord(params: {
    storageKey: string
    fileName?: string | null
    contentType?: string | null
    fileSize?: number | null
    category?: string | null
    metadata?: Record<string, unknown> | null
  }): Promise<void> {
    const metadataJson = JSON.stringify(params.metadata ?? null)
    await this.db.execute(sql`
      INSERT INTO storage_records (
        storage_key, file_name, content_type, file_size, category, status, metadata
      ) VALUES (
        ${params.storageKey},
        ${params.fileName ?? null},
        ${params.contentType ?? null},
        ${params.fileSize ?? null},
        ${params.category ?? null},
        'active',
        CAST(${metadataJson} AS jsonb)
      )
      ON CONFLICT (storage_key) DO UPDATE SET
        file_name = COALESCE(EXCLUDED.file_name, storage_records.file_name),
        content_type = COALESCE(EXCLUDED.content_type, storage_records.content_type),
        file_size = COALESCE(EXCLUDED.file_size, storage_records.file_size),
        category = COALESCE(EXCLUDED.category, storage_records.category),
        metadata = (
          COALESCE(storage_records.metadata, '{}'::jsonb)
          || COALESCE(EXCLUDED.metadata, '{}'::jsonb)
          || jsonb_strip_nulls(jsonb_build_object(
            'verified', (
              COALESCE((storage_records.metadata->>'verified')::boolean, false)
              OR COALESCE((EXCLUDED.metadata->>'verified')::boolean, false)
            ),
            'verifiedAt', COALESCE(
              storage_records.metadata->>'verifiedAt',
              EXCLUDED.metadata->>'verifiedAt'
            ),
            'uploadedBy', COALESCE(
              storage_records.metadata->>'uploadedBy',
              EXCLUDED.metadata->>'uploadedBy'
            ),
            'profileId', COALESCE(
              storage_records.metadata->>'profileId',
              EXCLUDED.metadata->>'profileId'
            ),
            'purpose', COALESCE(
              storage_records.metadata->>'purpose',
              EXCLUDED.metadata->>'purpose'
            )
          ))
        ),
        updated_at = NOW()
    `)
  }

  async getStorageRecordStatus(storageKey: string): Promise<StorageRecordStatus | null> {
    const rows = await this.db
      .select({ status: storageRecords.status })
      .from(storageRecords)
      .where(eq(storageRecords.storageKey, storageKey))
      .limit(1)

    if (rows.length === 0) return null
    return rows[0]!.status as StorageRecordStatus
  }

  async markStorageRecordImmutable(storageKey: string, signedBy?: string): Promise<void> {
    const now = new Date()
    await this.db
      .update(storageRecords)
      .set({
        status: 'immutable',
        signedAt: now,
        signedBy: signedBy ?? null,
        updatedAt: now,
      })
      .where(eq(storageRecords.storageKey, storageKey))
  }

  async softDeleteStorageRecord(storageKey: string): Promise<void> {
    const now = new Date()
    await this.db
      .update(storageRecords)
      .set({
        status: 'removed',
        removedAt: now,
        updatedAt: now,
      })
      .where(eq(storageRecords.storageKey, storageKey))
  }

  async updateStorageRecordMetadata(
    storageKey: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.db
      .update(storageRecords)
      .set({
        metadata,
        updatedAt: new Date(),
      })
      .where(eq(storageRecords.storageKey, storageKey))
  }
}