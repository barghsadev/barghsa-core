/**
 * @barghsa/storage — Storage provider abstraction.
 *
 * Defines the `StorageProvider` interface that all object-storage backends
 * must implement, along with supporting types.
 */

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

/** Arbitrary user-defined metadata stored alongside an object. */
export type StorageMetadata = Record<string, string>;

/** Result of a `listObjects` call. */
export interface StorageObjectSummary {
  key: string;
  size: number;
  etag: string | undefined;
  lastModified: Date | undefined;
}

/** A single object returned from `getObject`. */
export interface StorageObject {
  /** Readable stream of the object body. */
  body: ReadableStream;
  /** Content-type, or `application/octet-stream` if unknown. */
  contentType: string;
  /** Content-length in bytes, if known. */
  contentLength: number | undefined;
  /** User-defined metadata. */
  metadata: StorageMetadata;
  /** Object etag, if available. */
  etag: string | undefined;
}

/** Configuration accepted by all providers. */
export interface StorageProviderConfig {
  /**
   * Bucket / container name.
   * Must be a valid bucket name per the provider's rules.
   */
  bucket: string;
  /** Optional path prefix applied to every key (e.g. `"production/"`). */
  prefix?: string;
}

// ---------------------------------------------------------------------------
// Logger contract (no framework dependency)
// ---------------------------------------------------------------------------

export interface Logger {
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

/**
 * Object-storage provider.
 *
 * Implementations wrap a specific backend (e.g. S3, MinIO, GCS) behind
 * a uniform interface so consumers never depend on a particular provider.
 *
 * **Key design decisions:**
 * - Streaming `getObject` — never buffer the full body in memory.
 * - Presigned URLs for browser uploads/downloads so large bodies never
 *   proxy through the API server.
 * - The factory selects the right implementation based on runtime config.
 */
export interface StorageProvider {
  /**
   * Upload (or overwrite) an object.
   *
   * @param key        Object key (relative to any configured prefix).
   * @param body       `ReadableStream`, `Blob`, `Buffer`, or `string`.
   * @param contentType MIME type of the object.
   * @param metadata   Optional user-defined metadata.
   */
  putObject(
    key: string,
    body: ReadableStream | Blob | Uint8Array | string,
    contentType: string,
    metadata?: StorageMetadata,
  ): Promise<void>;

  /**
   * Retrieve an object as a readable stream.
   *
   * Throws a `StorageObjectNotFound` error when the key does not exist.
   */
  getObject(key: string): Promise<StorageObject>;

  /**
   * Delete an object.
   *
   * Deleting a non-existent key is **not** an error (idempotent).
   */
  deleteObject(key: string): Promise<void>;

  /**
   * Generate a presigned URL for a browser to _upload_ an object via PUT.
   *
   * The URL is time-limited: the client must complete the upload before
   * `expiresIn` seconds.
   */
  presignedPutUrl(key: string, expiresIn?: number): Promise<string>;

  /**
   * Generate a presigned URL for a browser to _download_ an object via GET.
   *
   * The URL is time-limited: the client must complete the download before
   * `expiresIn` seconds.
   */
  presignedGetUrl(key: string, expiresIn?: number): Promise<string>;

  /**
   * List objects whose key starts with the given prefix.
   *
   * Returns up to `maxKeys` items per call.  If the result is truncated,
   * consumers can pass back the `continuationToken` to page through results.
   */
  listObjects(
    prefix: string,
    maxKeys?: number,
    continuationToken?: string,
  ): Promise<{
    items: StorageObjectSummary[];
    isTruncated: boolean;
    continuationToken: string | undefined;
  }>;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** Thrown by `getObject` when the requested key does not exist. */
export class StorageObjectNotFound extends Error {
  constructor(
    public readonly key: string,
    message?: string,
  ) {
    super(message ?? `Object not found: ${key}`);
    this.name = 'StorageObjectNotFound';
  }
}

/** Thrown when a provider-level configuration or connection error occurs. */
export class StorageProviderError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'StorageProviderError';
  }
}