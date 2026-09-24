import {
  S3Client,
  S3ClientConfig,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  PutObjectCommandInput,
  ListObjectsV2Command,
  ListObjectsV2CommandInput,
  HeadBucketCommand,
  ListObjectVersionsCommand,
  GetObjectTaggingCommand,
  PutObjectTaggingCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  ListPartsCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListMultipartUploadsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import { NoSuchKey } from '@aws-sdk/client-s3';

import type {
  StorageProvider,
  StorageObject,
  StorageObjectSummary,
  StorageMetadata,
  StorageProviderConfig,
  Logger,
  MultipartPart,
  MultipartUploadSummary,
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

  destroy(): void {
    this.client.destroy();
  }

  async createMultipartUpload(key: string, contentType: string): Promise<string> {
    const result = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: this.resolveKey(key),
        ContentType: contentType,
      })
    );
    if (!result.UploadId) throw new StorageProviderError('Storage did not return a multipart ID');
    return result.UploadId;
  }

  presignedUploadPartUrl(key: string, uploadId: string, partNumber: number, expiresIn = 3600) {
    return getSignedUrl(
      this.client,
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: this.resolveKey(key),
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn }
    );
  }

  async listMultipartParts(key: string, uploadId: string): Promise<MultipartPart[]> {
    const parts: MultipartPart[] = [];
    let marker: string | undefined;
    for (;;) {
      const page = await this.client.send(
        new ListPartsCommand({
          Bucket: this.bucket,
          Key: this.resolveKey(key),
          UploadId: uploadId,
          PartNumberMarker: marker,
          MaxParts: 1000,
        })
      );
      for (const part of page.Parts ?? []) {
        if (!part.PartNumber || !part.ETag || part.Size === undefined)
          throw new StorageProviderError('Storage returned an incomplete multipart part');
        parts.push({ partNumber: part.PartNumber, etag: part.ETag, size: part.Size });
      }
      if (!page.IsTruncated) return parts;
      if (!page.NextPartNumberMarker || page.NextPartNumberMarker === marker)
        throw new StorageProviderError('Multipart part listing did not advance');
      marker = page.NextPartNumberMarker;
    }
  }

  async completeMultipartUpload(key: string, uploadId: string, parts: MultipartPart[]) {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: this.resolveKey(key),
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
        },
      })
    );
  }

  async abortMultipartUpload(key: string, uploadId: string) {
    try {
      await this.client.send(
        new AbortMultipartUploadCommand({
          Bucket: this.bucket,
          Key: this.resolveKey(key),
          UploadId: uploadId,
        })
      );
    } catch (error) {
      if ((error as { name?: string }).name !== 'NoSuchUpload') throw error;
    }
  }

  async listMultipartUploads(
    prefix: string,
    maxUploads = 100,
    keyMarker?: string,
    uploadIdMarker?: string
  ): Promise<{
    uploads: MultipartUploadSummary[];
    isTruncated: boolean;
    nextKeyMarker?: string | undefined;
    nextUploadIdMarker?: string | undefined;
  }> {
    const page = await this.client.send(
      new ListMultipartUploadsCommand({
        Bucket: this.bucket,
        Prefix: this.resolveKey(prefix),
        MaxUploads: maxUploads,
        KeyMarker: keyMarker ? this.resolveKey(keyMarker) : undefined,
        UploadIdMarker: uploadIdMarker,
      })
    );
    return {
      uploads: (page.Uploads ?? []).flatMap((upload) =>
        upload.Key?.startsWith(this.prefix) && upload.UploadId && upload.Initiated
          ? [
              {
                key: upload.Key.slice(this.prefix.length),
                uploadId: upload.UploadId,
                initiatedAt: upload.Initiated,
              },
            ]
          : []
      ),
      isTruncated: page.IsTruncated ?? false,
      nextKeyMarker: page.NextKeyMarker?.startsWith(this.prefix)
        ? page.NextKeyMarker.slice(this.prefix.length)
        : undefined,
      nextUploadIdMarker: page.NextUploadIdMarker,
    };
  }

  async checkHealth(signal: AbortSignal = AbortSignal.timeout(1500)): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }), { abortSignal: signal });
  }

  async scheduleExpiration(
    key: string
  ): Promise<{ eligibleVersions: number; heldVersions: number }> {
    if (!/^(tmp|uploads|previews|superseded)\//.test(key))
      throw new StorageProviderError('Object key has no configured expiration policy');
    const resolvedKey = this.resolveKey(key);
    const result = { eligibleVersions: 0, heldVersions: 0 };
    let KeyMarker: string | undefined, VersionIdMarker: string | undefined;
    const pages = new Set<string>();
    for (;;) {
      const page = await this.client.send(
        new ListObjectVersionsCommand({
          Bucket: this.bucket,
          Prefix: resolvedKey,
          KeyMarker,
          VersionIdMarker,
          MaxKeys: 100,
        })
      );
      for (const version of page.Versions ?? []) {
        if (version.Key !== resolvedKey) continue;
        if (!version.VersionId)
          throw new StorageProviderError('Storage returned a version without an ID');
        const target = { Bucket: this.bucket, Key: resolvedKey, VersionId: version.VersionId };
        const { TagSet = [] } = await this.client.send(new GetObjectTaggingCommand(target));
        const hold = TagSet.find((tag) => tag.Key === 'legal-hold');
        if (hold && hold.Value !== 'false') {
          result.heldVersions++;
          continue;
        }
        if (!hold)
          await this.client.send(
            new PutObjectTaggingCommand({
              ...target,
              Tagging: { TagSet: [...TagSet, { Key: 'legal-hold', Value: 'false' }] },
            })
          );
        result.eligibleVersions++;
      }
      if (!page.IsTruncated) return result;
      KeyMarker = page.NextKeyMarker;
      VersionIdMarker = page.NextVersionIdMarker;
      const marker = JSON.stringify([KeyMarker, VersionIdMarker]);
      if (!KeyMarker || pages.has(marker))
        throw new StorageProviderError('Storage version listing did not advance');
      pages.add(marker);
    }
  }

  async deleteObjectVersions(key: string): Promise<number> {
    if (!key.startsWith('business-documents/') && !key.startsWith('uploads/'))
      throw new StorageProviderError('Document destruction key is outside approved prefixes');
    const resolvedKey = this.resolveKey(key);
    const entries: { versionId: string; marker: boolean }[] = [];
    let KeyMarker: string | undefined;
    let VersionIdMarker: string | undefined;
    const seen = new Set<string>();
    for (;;) {
      const page = await this.client.send(
        new ListObjectVersionsCommand({
          Bucket: this.bucket,
          Prefix: resolvedKey,
          KeyMarker,
          VersionIdMarker,
          MaxKeys: 100,
        })
      );
      for (const version of page.Versions ?? []) {
        if (version.Key !== resolvedKey) continue;
        if (!version.VersionId)
          throw new StorageProviderError('Storage returned a version without an ID');
        const { TagSet = [] } = await this.client.send(
          new GetObjectTaggingCommand({
            Bucket: this.bucket,
            Key: resolvedKey,
            VersionId: version.VersionId,
          })
        );
        const hold = TagSet.find((tag) => tag.Key === 'legal-hold');
        if (hold && hold.Value !== 'false')
          throw new StorageProviderError('Document object version has a provider hold');
        entries.push({ versionId: version.VersionId, marker: false });
      }
      for (const marker of page.DeleteMarkers ?? []) {
        if (marker.Key !== resolvedKey) continue;
        if (!marker.VersionId)
          throw new StorageProviderError('Storage returned a delete marker without an ID');
        entries.push({ versionId: marker.VersionId, marker: true });
      }
      if (!page.IsTruncated) break;
      KeyMarker = page.NextKeyMarker;
      VersionIdMarker = page.NextVersionIdMarker;
      const cursor = JSON.stringify([KeyMarker, VersionIdMarker]);
      if (!KeyMarker || seen.has(cursor))
        throw new StorageProviderError('Storage version listing did not advance');
      seen.add(cursor);
    }
    for (const entry of entries)
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: resolvedKey,
          VersionId: entry.versionId,
        })
      );
    const remaining = await this.client.send(
      new ListObjectVersionsCommand({ Bucket: this.bucket, Prefix: resolvedKey, MaxKeys: 100 })
    );
    if (
      (remaining.Versions ?? []).some((version) => version.Key === resolvedKey) ||
      (remaining.DeleteMarkers ?? []).some((marker) => marker.Key === resolvedKey)
    )
      throw new StorageProviderError('Document object versions remain after destruction');
    const current = await this.client.send(
      new ListObjectsV2Command({ Bucket: this.bucket, Prefix: resolvedKey, MaxKeys: 1 })
    );
    if ((current.Contents ?? []).some((object) => object.Key === resolvedKey))
      throw new StorageProviderError('Document object remains after destruction');
    return entries.filter((entry) => !entry.marker).length;
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
    metadata?: StorageMetadata
  ): Promise<void> {
    const resolvedKey = this.resolveKey(key);

    const input: PutObjectCommandInput = {
      Bucket: this.bucket,
      Key: resolvedKey,
      Body: body,
      ContentType: contentType,
      Metadata: metadata,
    };

    try {
      if (body instanceof ReadableStream || body instanceof Blob) {
        // The upload helper chunks unknown-length web streams and aborts failed
        // multipart uploads. Direct PutObject cannot hash these bodies in Node.
        await new Upload({
          client: this.client,
          params: input,
          queueSize: 1,
          partSize: 5 * 1024 * 1024,
          leavePartsOnError: false,
        }).done();
      } else {
        await this.client.send(new PutObjectCommand(input));
      }
    } catch (err) {
      this.logger?.error(`[s3-storage-provider] Failed to put object "${resolvedKey}":`, err);
      throw new StorageProviderError(
        `Failed to put object "${resolvedKey}": ${err instanceof Error ? err.message : String(err)}`,
        err
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
        new GetObjectCommand({ Bucket: this.bucket, Key: resolvedKey })
      );

      if (!response.Body) {
        throw new StorageObjectNotFound(key, `Object "${resolvedKey}" returned empty body`);
      }

      return {
        body: response.Body.transformToWebStream(),
        contentType: response.ContentType ?? 'application/octet-stream',
        contentLength: response.ContentLength ?? undefined,
        metadata: (response.Metadata as StorageMetadata) ?? {},
        etag: response.ETag ?? undefined,
        versionId: response.VersionId,
      };
    } catch (err) {
      // Re-throw our own error type immediately — do not re-wrap.
      if (err instanceof StorageObjectNotFound) {
        throw err;
      }
      if (
        err instanceof NoSuchKey ||
        (err as { name?: string }).name === 'NoSuchKey' ||
        (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
      ) {
        throw new StorageObjectNotFound(key);
      }
      this.logger?.error(`[s3-storage-provider] Failed to get object "${resolvedKey}":`, err);
      throw new StorageProviderError(
        `Failed to get object "${resolvedKey}": ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    }
  }

  // -----------------------------------------------------------------------
  // deleteObject
  // -----------------------------------------------------------------------

  async deleteObject(key: string): Promise<void> {
    const resolvedKey = this.resolveKey(key);

    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: resolvedKey }));
    } catch (err) {
      this.logger?.error(`[s3-storage-provider] Failed to delete object "${resolvedKey}":`, err);
      throw new StorageProviderError(
        `Failed to delete object "${resolvedKey}": ${err instanceof Error ? err.message : String(err)}`,
        err
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
        new PutObjectCommand({ Bucket: this.bucket, Key: resolvedKey, IfNoneMatch: '*' }),
        {
          expiresIn: expiresIn ?? DEFAULT_EXPIRES_IN,
          signableHeaders: new Set(['if-none-match']),
        }
      );
    } catch (err) {
      this.logger?.error(
        `[s3-storage-provider] Failed to generate presigned PUT URL for "${resolvedKey}":`,
        err
      );
      throw new StorageProviderError(
        `Failed to generate presigned PUT URL for "${resolvedKey}": ${err instanceof Error ? err.message : String(err)}`,
        err
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
        { expiresIn: expiresIn ?? DEFAULT_EXPIRES_IN }
      );
    } catch (err) {
      this.logger?.error(
        `[s3-storage-provider] Failed to generate presigned GET URL for "${resolvedKey}":`,
        err
      );
      throw new StorageProviderError(
        `Failed to generate presigned GET URL for "${resolvedKey}": ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    }
  }

  // -----------------------------------------------------------------------
  // listObjects
  // -----------------------------------------------------------------------

  async listObjects(
    prefix: string,
    maxKeys?: number,
    continuationToken?: string
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
        key: obj.Key?.startsWith(this.prefix) ? obj.Key.slice(this.prefix.length) : (obj.Key ?? ''),
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
      this.logger?.error(
        `[s3-storage-provider] Failed to list objects with prefix "${resolvedPrefix}":`,
        err
      );
      throw new StorageProviderError(
        `Failed to list objects with prefix "${resolvedPrefix}": ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    }
  }
}
