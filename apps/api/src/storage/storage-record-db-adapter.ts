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
import { eq } from '@barghsa/db'
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
    await this.db.insert(storageRecords).values({
      storageKey: params.storageKey,
      fileName: params.fileName ?? null,
      contentType: params.contentType ?? null,
      fileSize: params.fileSize ?? null,
      category: params.category ?? null,
      status: 'active',
      metadata: params.metadata ?? null,
    })
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