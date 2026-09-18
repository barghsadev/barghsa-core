/**
 * @barghsa/storage — Immutable storage record service.
 *
 * Legacy record facade. Deletion only hides database records; it never deletes
 * object bytes. Physical cleanup belongs to the authorized durable worker flow,
 * whose locked database checks cannot race signing.
 *
 * S3 versioning (configured in T-04.03.03) ensures that even if an
 * object is accidentally overwritten, previous versions are preserved.
 */

import type { StorageProvider } from './storage-provider.js';
import { StorageObjectNotFound } from './storage-provider.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Storage record lifecycle status. */
export type StorageRecordStatus = 'active' | 'immutable' | 'removed';

/** Minimal DB interface required by the immutable storage service. */
export interface DbAdapter {
  createStorageRecord(params: {
    storageKey: string;
    fileName?: string | null;
    contentType?: string | null;
    fileSize?: number | null;
    category?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<void>;

  getStorageRecordStatus(storageKey: string): Promise<StorageRecordStatus | null>;

  markStorageRecordImmutable(storageKey: string, signedBy?: string): Promise<void>;

  softDeleteStorageRecord(storageKey: string): Promise<void>;

  updateStorageRecordMetadata(storageKey: string, metadata: Record<string, unknown>): Promise<void>;
}

/** Options for creating a storage record. */
export interface CreateRecordOptions {
  storageKey: string;
  fileName?: string | undefined;
  contentType?: string | undefined;
  fileSize?: number | undefined;
  category?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

/** Result of a storage record query. */
export interface StorageRecordInfo {
  key: string;
  status: StorageRecordStatus;
  fileName: string | null;
  contentType: string | null;
  fileSize: number | null;
  category: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  signedAt: Date | null;
  signedBy: string | null;
  removedAt: Date | null;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** Thrown when trying to delete an immutable storage record. */
export class ImmutableRecordDeleteError extends Error {
  constructor(
    public readonly storageKey: string,
    status: StorageRecordStatus
  ) {
    super(
      `Cannot physically delete storage record "${storageKey}": status is "${status}". ` +
        'Use soft delete instead — the record will be marked as removed in PostgreSQL ' +
        'while the underlying object is retained in S3.'
    );
    this.name = 'ImmutableRecordDeleteError';
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Immutable storage record service.
 *
 * Coordinates between the {@link StorageProvider} and the
 * `storage_records` database table to enforce immutability of
 * signed/approved documents.
 *
 * **Lifecycle:**
 * 1. On upload verification, call {@link createRecord} to track the object.
 * 2. When the document is signed/approved, call {@link markAsImmutable}.
 * 3. Deletion through {@link deleteRecord} only soft-deletes known records.
 *    Production HTTP mutations use the transaction-authorized admin service.
 */
export class ImmutableStorageRecordService {
  constructor(
    private readonly storage: StorageProvider,
    private readonly db: DbAdapter
  ) {}

  // -----------------------------------------------------------------------
  // createRecord
  // -----------------------------------------------------------------------

  /**
   * Create a `storage_records` entry for an uploaded object.
   *
   * Should be called after the upload is verified (i.e. the browser has
   * PUT the file to the presigned URL and the API confirms it exists).
   */
  async createRecord(options: CreateRecordOptions): Promise<void> {
    await this.db.createStorageRecord({
      storageKey: options.storageKey,
      fileName: options.fileName ?? null,
      contentType: options.contentType ?? null,
      fileSize: options.fileSize ?? null,
      category: options.category ?? null,
      metadata: (options.metadata as Record<string, unknown> | null) ?? null,
    });
  }

  // -----------------------------------------------------------------------
  // getRecordStatus
  // -----------------------------------------------------------------------

  /**
   * Get the current lifecycle status of a storage record.
   *
   * Returns `null` when the record does not exist in the database.
   */
  async getRecordStatus(storageKey: string): Promise<StorageRecordStatus | null> {
    return this.db.getStorageRecordStatus(storageKey);
  }

  // -----------------------------------------------------------------------
  // markAsImmutable
  // -----------------------------------------------------------------------

  /**
   * Mark a storage record as immutable (signed/approved).
   *
   * After this call, any attempt to physically delete the object will
   * be rejected and the record will instead be soft-deleted.
   *
   * @throws {StorageObjectNotFound} When the key does not exist in storage.
   * @throws {Error} When the record does not exist in the database.
   */
  async markAsImmutable(storageKey: string, signedBy?: string): Promise<void> {
    // Verify the object actually exists in storage
    try {
      const object = await this.storage.getObject(storageKey);
      await object.body.cancel();
    } catch (err) {
      if (err instanceof StorageObjectNotFound) {
        throw new StorageObjectNotFound(
          storageKey,
          `Cannot mark "${storageKey}" as immutable: object not found in storage.`
        );
      }
      throw err;
    }

    await this.db.markStorageRecordImmutable(storageKey, signedBy);
  }

  // -----------------------------------------------------------------------
  // deleteRecord
  // -----------------------------------------------------------------------

  /**
   * Delete a storage record, enforcing immutability.
   *
   * Known records are soft-deleted while all object bytes are retained.
   * Missing and already removed records are no-ops. A status read is not
   * authority for physical deletion: signing can commit immediately after it.
   *
   * @throws {ImmutableRecordDeleteError} When attempting to delete an
   *   immutable record (the soft delete is still performed).
   */
  async deleteRecord(storageKey: string): Promise<void> {
    const status = await this.db.getStorageRecordStatus(storageKey);

    if (!status || status === 'removed') return;

    if (status === 'immutable') {
      // Soft delete only — retain the underlying S3 object
      await this.db.softDeleteStorageRecord(storageKey);
      throw new ImmutableRecordDeleteError(storageKey, status);
    }

    // Preserve bytes even if the earlier status snapshot became stale.
    await this.db.softDeleteStorageRecord(storageKey);
  }

  // -----------------------------------------------------------------------
  // updateMetadata
  // -----------------------------------------------------------------------

  /**
   * Update the metadata associated with a storage record.
   */
  async updateMetadata(storageKey: string, metadata: Record<string, unknown>): Promise<void> {
    await this.db.updateStorageRecordMetadata(storageKey, metadata);
  }
}
