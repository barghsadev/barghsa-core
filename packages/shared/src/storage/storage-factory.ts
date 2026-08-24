import type { StorageProvider, Logger, StorageProviderConfig } from './storage-provider.js';
import { S3StorageProvider, type S3StorageProviderConfig } from './s3-storage-provider.js';

/**
 * Create a storage provider based on runtime configuration.
 *
 * Currently only the S3 provider is implemented.  When additional backends
 * are added (e.g. GCS, Azure Blob), extend this factory to select based on
 * a `type` discriminator in the config.
 *
 * @throws {Error} When no matching provider can be determined from config.
 */
export function createStorageProvider(
  config: S3StorageProviderConfig,
  logger?: Logger,
): StorageProvider {
  return new S3StorageProvider(config, logger);
}