import {
  S3Client,
  S3ClientConfig,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  PutObjectCommandInput,
  ListObjectsV2Command,
  ListObjectsV2CommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NoSuchKey } from '@aws-sdk/client-s3';

import type {
  StorageProvider,
  StorageObject,
  StorageObjectSummary,
  StorageMetadata,
  StorageProviderConfig,
  Logger,
} from './storage-provider.js';
import { StorageObjectNotFound, StorageProviderError } from './storage-provider.js';

// ---------------------------------------------------------------------------
// S3-specific config
// ---------------------------------------------------------------------------

export interface S3StorageProviderConfig extends StorageProviderConfig {
  /** S3 endpoint URL (for MinIO / custom endpoints). */
  endpoint?: string;
  /** AWS region. */
  region: string;
  /** AWS access key ID. */
  accessKeyId?: string;
  /** AWS secret access key. */
  secretAccessKey?: string;
  /** Force path-style addressing (required for MinIO). */
  forcePathStyle?: boolean;
  /** AWS Signature version. */
  signatureVersion?: 'v4';
  /** Maximum number of retries. */
  maxRetries?: number;
  /** Request timeout in milliseconds. */
  requestTimeoutMs?: number;
}

const DEFAULT_EXPIRES_IN = 3600; // 1 hour
const DEFAULT_MAX_KEYS = 100;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * S3-compatible storage provider.
 *
 * Works with AWS S3, MinIO, DigitalOcean Spaces, and any S3-compatible API.
 * Uses `@aws-sdk/client-s3` for all operations.
 */
export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly logger: Logger | undefined;

  constructor(config: S3StorageProviderConfig, logger?: Logger) {
    this.bucket = config.bucket;
    this.prefix = config.prefix ?? '';
    this.logger = logger;

    const clientConfig: S3ClientConfig = {
      region: config.region,
      forcePathStyle: config.forcePathStyle ?? false,
      maxAttempts: config.maxRetries ?? 3,
      requestHandler: {
        requestTimeout: config.requestTimeoutMs ?? 30_000,
      },
    };

    if (config.endpoint) {
      clientConfig.endpoint = config.endpoint;
    }

    if (config.accessKeyId && config.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      };
    }

    this.client = new S3Client(clientConfig);
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /** Resolve a logical key to the full storage key (with prefix). */
  private resolveKey(key: string): string {
    return this.prefix ? `${this.prefix}${key}` : key;
  }

  // -----------------------------------------------------------------------
  // putObject
  // -----------------------------------------------------------------------

  async putObject(
    key: string,
    body: ReadableStream | Blob | Uint8Array | string,
    contentType: string,
    metadata?: StorageMetadata,
  ): Promise<void> {
    const resolvedKey = this.resolveKey(key);

    const sdkBody =
      body instanceof ReadableStream
        ? (body as never) // SDK accepts Readable (Node stream); ReadableStream from web falls through
        : body instanceof Blob
          ? (body as never)
          : body;

    const input: PutObjectCommandInput = {
      Bucket: this.bucket,
      Key: resolvedKey,
      Body: sdkBody,
      ContentType: contentType,
      Metadata: metadata,
    };

    try {
      await this.client.send(new PutObjectCommand(input));
    } catch (err) {
      throw new StorageProviderError(
        `Failed to put object "${resolvedKey}": ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  // -----------------------------------------------------------------------
  // getObject
  // -----------------------------------------------------------------------

  async getObject(key: string): Promise<StorageObject> {
    const resolvedKey = this.resolveKey(key);

    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: resolvedKey }),
      );

      if (!response.Body) {
        throw new StorageObjectNotFound(key, `Object "${resolvedKey}" returned empty body`);
      }

      return {
        body: response.Body as unknown as ReadableStream,
        contentType: response.ContentType ?? 'application/octet-stream',
        contentLength: response.ContentLength ?? undefined,
        metadata: (response.Metadata as StorageMetadata) ?? {},
        etag: response.ETag ?? undefined,
      };
    } catch (err) {
      if (err instanceof NoSuchKey || (err as { name?: string }).name === 'NoSuchKey') {
        throw new StorageObjectNotFound(key);
      }
      throw new StorageProviderError(
        `Failed to get object "${resolvedKey}": ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  // -----------------------------------------------------------------------
  // deleteObject
  // -----------------------------------------------------------------------

  async deleteObject(key: string): Promise<void> {
    const resolvedKey = this.resolveKey(key);

    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: resolvedKey }),
      );
    } catch (err) {
      throw new StorageProviderError(
        `Failed to delete object "${resolvedKey}": ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  // -----------------------------------------------------------------------
  // presignedPutUrl
  // -----------------------------------------------------------------------

  async presignedPutUrl(key: string, expiresIn?: number): Promise<string> {
    const resolvedKey = this.resolveKey(key);

    try {
      return await getSignedUrl(
        this.client,
        new PutObjectCommand({ Bucket: this.bucket, Key: resolvedKey }),
        { expiresIn: expiresIn ?? DEFAULT_EXPIRES_IN },
      );
    } catch (err) {
      throw new StorageProviderError(
        `Failed to generate presigned PUT URL for "${resolvedKey}": ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  // -----------------------------------------------------------------------
  // presignedGetUrl
  // -----------------------------------------------------------------------

  async presignedGetUrl(key: string, expiresIn?: number): Promise<string> {
    const resolvedKey = this.resolveKey(key);

    try {
      return await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: this.bucket, Key: resolvedKey }),
        { expiresIn: expiresIn ?? DEFAULT_EXPIRES_IN },
      );
    } catch (err) {
      throw new StorageProviderError(
        `Failed to generate presigned GET URL for "${resolvedKey}": ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  // -----------------------------------------------------------------------
  // listObjects
  // -----------------------------------------------------------------------

  async listObjects(
    prefix: string,
    maxKeys?: number,
    continuationToken?: string,
  ): Promise<{
    items: StorageObjectSummary[];
    isTruncated: boolean;
    continuationToken: string | undefined;
  }> {
    const resolvedPrefix = this.resolveKey(prefix);

    const input: ListObjectsV2CommandInput = {
      Bucket: this.bucket,
      Prefix: resolvedPrefix,
      MaxKeys: maxKeys ?? DEFAULT_MAX_KEYS,
    };

    if (continuationToken) {
      input.ContinuationToken = continuationToken;
    }

    try {
      const response = await this.client.send(new ListObjectsV2Command(input));

      const items: StorageObjectSummary[] = (response.Contents ?? []).map((obj) => ({
        key: obj.Key?.startsWith(this.prefix)
          ? obj.Key.slice(this.prefix.length)
          : (obj.Key ?? ''),
        size: obj.Size ?? 0,
        etag: obj.ETag ?? undefined,
        lastModified: obj.LastModified ?? undefined,
      }));

      return {
        items,
        isTruncated: response.IsTruncated ?? false,
        continuationToken: response.NextContinuationToken ?? undefined,
      };
    } catch (err) {
      throw new StorageProviderError(
        `Failed to list objects with prefix "${resolvedPrefix}": ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }
}