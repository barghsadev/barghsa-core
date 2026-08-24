/**
 * NestJS injection tokens for the storage module.
 *
 * Extracted to a separate file to avoid circular-dependency TDZ issues
 * between storage.module.ts and its controllers.
 */

/** Injection token for the StorageProvider instance. */
export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

/** Injection token for the ImmutableStorageRecordService instance. */
export const IMMUTABLE_STORAGE_SERVICE = Symbol('IMMUTABLE_STORAGE_SERVICE');