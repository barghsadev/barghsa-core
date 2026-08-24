export type {
  StorageProvider,
  StorageObject,
  StorageObjectSummary,
  StorageMetadata,
  StorageProviderConfig,
} from './storage-provider.js';
export {
  StorageObjectNotFound,
  StorageProviderError,
} from './storage-provider.js';

export type { S3StorageProviderConfig } from './s3-storage-provider.js';
export { S3StorageProvider } from './s3-storage-provider.js';

export type { StorageProviderFactoryConfig } from './storage-factory.js';
export { createStorageProvider } from './storage-factory.js';

export type { BucketSetupConfig, BucketSetupResult } from './setup-bucket.js';
export { setupBucket, getStandardLifecycleRules } from './setup-bucket.js';