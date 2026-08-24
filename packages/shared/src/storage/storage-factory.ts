import type { StorageProvider, Logger } from './storage-provider.js';
import { S3StorageProvider, type S3StorageProviderConfig } from './s3-storage-provider.js';

/**
 * Discriminated storage provider configuration.
 *
 * Currently only `type: 's3'` is supported.  Add new backends by
 * extending this union with additional provider config types.
 */
export type StorageProviderFactoryConfig =
  | (S3StorageProviderConfig & { type?: 's3' });

/**
 * Create a storage provider based on runtime configuration.
 *
 * @example
 * ```ts
 * const storage = createStorageProvider({
 *   type: 's3',
 *   bucket: 'my-bucket',
 *   region: 'us-east-1',
 *   endpoint: 'http://localhost:9000',
 *   accessKeyId: 'minioadmin',
 *   secretAccessKey: 'minioadmin',
 *   forcePathStyle: true,
 * });
 * ```
 *
 * @throws {Error} When an unknown provider type is specified.
 */
export function createStorageProvider(
  config: StorageProviderFactoryConfig,
  logger?: Logger,
): StorageProvider {
  if (config.type !== undefined && config.type !== 's3') {
    throw new Error(
      `Unknown storage provider type: "${config.type}". Supported: "s3".`,
    );
  }
  return new S3StorageProvider(config, logger);
}