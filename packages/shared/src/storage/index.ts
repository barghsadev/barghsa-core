export type {
  StorageProvider,
  IFileStorageProvider,
  StorageUploadReceipt,
  StorageObject,
  StorageObjectSummary,
  StorageMetadata,
  StorageProviderConfig,
  MultipartPart,
  MultipartUploadSummary,
} from './storage-provider.js';
export {
  StorageObjectNotFound,
  StorageProviderError,
  StorageBatchDeleteError,
} from './storage-provider.js';

export type { S3StorageProviderConfig } from './s3-storage-provider.js';
export { S3StorageProvider } from './s3-storage-provider.js';

export type { StorageProviderFactoryConfig } from './storage-factory.js';
export { createStorageProvider } from './storage-factory.js';

export type { BucketSetupConfig, BucketSetupResult } from './setup-bucket.js';
export { setupBucket, getStandardLifecycleRules } from './setup-bucket.js';

export type {
  StorageRecordStatus,
  DbAdapter,
  CreateRecordOptions,
  StorageRecordInfo,
} from './immutable-storage.js';
export { ImmutableStorageRecordService, ImmutableRecordDeleteError } from './immutable-storage.js';
export * from './runtime-config.js';
export { scanUploadWithClamAv, scanWithClamAv } from './clamav.js';
export type { ScannerEndpoint, ScanVerdict } from './clamav.js';
export { readCappedBytes, readCappedJson } from './read-capped-bytes.js';
export {
  MULTIPART_PART_SIZE,
  validMultipartParts,
  finishMultipartUpload,
} from './multipart-upload.js';
export type { MultipartUploadState } from './multipart-upload.js';

export const STORAGE_UPLOAD_SCAN_JOB_TYPE = 'storage-upload-scan';
