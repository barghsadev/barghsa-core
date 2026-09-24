import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  reserveUpload,
  requireOwnedUpload,
  completeUpload,
  recordUploadInspection,
} from './upload-reservations.js';
import { randomUUID } from 'node:crypto';
import { getDbPool } from '@barghsa/db';
import type { PoolClient } from 'pg';
import { ProfilesService } from '../profiles/profiles.service.js';
import { requireUploadContext } from './upload-access.js';
import { detectDocumentContentType } from './document-content-type.js';
import type { MultipartPart, StorageProvider } from '@barghsa/shared/storage';
import { StorageObjectNotFound, type ImmutableStorageRecordService } from '@barghsa/shared/storage';
import { STORAGE_PROVIDER, IMMUTABLE_STORAGE_SERVICE } from '../storage/index.js';
import { type AuthenticatedRequest } from '../session/session.guard.js';
import {
  PresignedUrlRequestSchema,
  RecordUploadRequestSchema,
  UploadContextSchema,
  type PresignedUrlRequest,
  type PresignedUrlResponse,
  type VerifyUploadResponse,
} from './upload.types.js';
import { getCategoryDescriptions, resolveCategory, UPLOAD_CATEGORIES } from './upload.config.js';
import {
  UploadPolicyResolver,
  effectiveAllowsExtension,
  effectiveMimeTypesForFile,
  effectiveAllowsSize,
} from './upload-policy.resolver.js';
import {
  pickDetectedContentType,
  sniffContentTypes,
  SNIFF_SAMPLE_BYTES,
} from './content-type-sniffer.js';

const UPLOAD_PREFIX = 'uploads/';
const DEFAULT_EXPIRES_IN = 3600; // 1 hour
const MULTIPART_EXPIRES_IN = 24 * 3600;
const MULTIPART_PART_SIZE = 5 * 1024 * 1024;

type MultipartRecord = {
  storage_key: string;
  file_size: string;
  content_type: string;
  metadata: {
    multipart?: { id: string; providerId: string; status: 'in_progress' | 'completed' | 'aborted' };
    uploadExpiresAt?: string;
  };
};

@Injectable()
export class UploadService {
  constructor(
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProvider | null,
    @Inject(IMMUTABLE_STORAGE_SERVICE)
    private readonly immutableStorageService: ImmutableStorageRecordService | null,
    @Inject(UploadPolicyResolver)
    private readonly policyResolver: UploadPolicyResolver,
    @Inject(ProfilesService) private readonly profilesService: ProfilesService
  ) {}

  /**
   * Generate a presigned PUT URL for direct browser-to-S3 upload.
   *
   * Validates file type, size, and permissions before returning the URL.
   * The API never proxies file bodies — only metadata.
   *
   * Since T-09.12.05 the checks run against the EFFECTIVE upload policy:
   * the admin-configured DB policy (`upload_policies`) bounded by the
   * deployment-level limits in `upload.config.ts`. Extension + claimed
   * content type + size are all validated here; the *detected* content
   * type is additionally verified on the `:key/verify` seam (magic-byte
   * sniffing, because presigned uploads never pass through the API).
   */
  async getPresignedUrl(raw: unknown, actor: AuthenticatedRequest): Promise<PresignedUrlResponse> {
    this.ensureStorageReady();

    const uniqueKey = await this.reserveNewUpload(raw, actor, DEFAULT_EXPIRES_IN);
    try {
      const presignedUrl = await this.storage!.presignedPutUrl(uniqueKey, DEFAULT_EXPIRES_IN);

      return {
        key: uniqueKey,
        presignedUrl,
        headers: { 'If-None-Match': '*' },
        expiresIn: DEFAULT_EXPIRES_IN,
      };
    } catch (err) {
      throw new InternalServerErrorException('Failed to generate presigned URL', { cause: err });
    }
  }

  private async reserveNewUpload(raw: unknown, actor: AuthenticatedRequest, expiresIn: number) {
    // Parse and validate request
    const parsed = PresignedUrlRequestSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid upload request',
        errors: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }

    const req: PresignedUrlRequest = parsed.data;
    if (req.metadata?.recordId !== undefined)
      throw new BadRequestException(
        'Business record association must use its authorized attachment endpoint'
      );
    await requireUploadContext(this.profilesService, actor, req);
    const category = req.category ?? resolveCategory(req.metadata?.recordType);

    const policy = await this.policyResolver.resolveEffective(category);

    // Validate file extension against the effective policy
    if (!effectiveAllowsExtension(policy, req.fileName)) {
      const cfg = getCategoryDescriptions();
      throw new BadRequestException({
        message: `File type not allowed for category "${category}"`,
        allowedExtensions:
          policy.allowedExtensions === null
            ? (cfg[category]?.allowedExtensions ?? 'any')
            : policy.allowedExtensions.join(', '),
        policySource: policy.source,
      });
    }

    // Validate MIME type against the effective policy
    const allowedMimeTypes = effectiveMimeTypesForFile(policy, req.fileName);
    if (!allowedMimeTypes.includes(req.contentType)) {
      throw new BadRequestException({
        message: `Content type "${req.contentType}" not allowed for category "${category}"`,
        allowedMimeTypes,
        policySource: policy.source,
      });
    }

    // Validate file size against the effective policy
    if (!effectiveAllowsSize(policy, req.fileSize)) {
      throw new BadRequestException({
        message: `File size exceeds maximum of ${policy.maxSizeBytes / (1024 * 1024)} MB for category "${category}"`,
        maxSizeBytes: policy.maxSizeBytes,
        actualBytes: req.fileSize,
        policySource: policy.source,
      });
    }

    // Generate a unique key. The (already validated) category is bound
    // into the key — `uploads/<category>/<uuid><ext>` — so the verify
    // seam can re-derive it server-side instead of trusting a
    // client-supplied body field (T-09.12.05).
    const ext = req.fileName.includes('.')
      ? req.fileName.slice(req.fileName.lastIndexOf('.')).toLowerCase()
      : '';
    const uniqueKey = `${UPLOAD_PREFIX}${category}/${randomUUID()}${ext}`;

    await reserveUpload({
      key: uniqueKey,
      userId: actor.session.userId,
      fileName: req.fileName,
      contentType: req.contentType,
      fileSize: req.fileSize,
      category,
      expiresIn,
      context: { purpose: req.purpose, profileId: req.profileId },
    });
    return uniqueKey;
  }

  private requireMultipartStorage() {
    this.ensureStorageReady();
    if (
      !this.storage?.createMultipartUpload ||
      !this.storage.presignedUploadPartUrl ||
      !this.storage.listMultipartParts ||
      !this.storage.completeMultipartUpload ||
      !this.storage.abortMultipartUpload
    )
      throw new ServiceUnavailableException('Multipart storage is unavailable');
    return this.storage;
  }

  async startMultipart(raw: unknown, actor: AuthenticatedRequest) {
    return this.getMultipartUpload(raw, actor);
  }

  async getMultipartUpload(raw: unknown, actor: AuthenticatedRequest) {
    this.requireMultipartStorage();
    const parsed = PresignedUrlRequestSchema.safeParse(raw);
    if (!parsed.success || parsed.data.fileSize <= MULTIPART_PART_SIZE)
      throw new BadRequestException('Multipart upload requires a file larger than 5 MiB');
    const key = await this.reserveNewUpload(raw, actor, MULTIPART_EXPIRES_IN);
    return {
      ...(await this.startMultipartForKey(key, actor.session.userId)),
      expiresIn: MULTIPART_EXPIRES_IN,
    };
  }

  /** Reuse an existing owned reservation, including document-specific reservations. */
  async startMultipartForKey(key: string, userId: string) {
    const storage = this.requireMultipartStorage();
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const row = (
        await client.query<MultipartRecord>(
          `SELECT storage_key,file_size,content_type,metadata FROM storage_records
           WHERE storage_key=$1 AND metadata->>'uploadedBy'=$2 AND status='removed'
             AND signed_at IS NULL AND metadata->>'provisionalUpload'='true'
             AND metadata->>'deletionRequested'='true'
             AND (metadata->>'uploadExpiresAt')::timestamptz>clock_timestamp()
           FOR UPDATE`,
          [key, userId]
        )
      ).rows[0];
      if (!row) throw new ConflictException('Upload reservation is unavailable');
      if (Number(row.file_size) <= MULTIPART_PART_SIZE)
        throw new BadRequestException('Multipart upload requires a file larger than 5 MiB');
      let multipart = row.metadata.multipart;
      if (!multipart) {
        const providerId = await storage.createMultipartUpload!(key, row.content_type);
        multipart = { id: randomUUID(), providerId, status: 'in_progress' };
        await client.query(
          `UPDATE storage_records SET metadata=jsonb_set(metadata,'{multipart}',$2::jsonb,true),
            updated_at=NOW() WHERE storage_key=$1`,
          [key, JSON.stringify(multipart)]
        );
      }
      if (multipart.status !== 'in_progress')
        throw new ConflictException('Multipart upload is no longer active');
      await client.query('COMMIT');
      return {
        uploadId: multipart.id,
        key,
        partSize: MULTIPART_PART_SIZE,
        partCount: Math.ceil(Number(row.file_size) / MULTIPART_PART_SIZE),
        expiresAt: row.metadata.uploadExpiresAt,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async ownedMultipart(id: string, userId: string, client?: PoolClient) {
    const row = (
      await (client ?? getDbPool()).query<MultipartRecord>(
        `SELECT storage_key,file_size,content_type,metadata FROM storage_records
         WHERE metadata->'multipart'->>'id'=$1 AND metadata->>'uploadedBy'=$2
           AND status='removed' AND signed_at IS NULL
           AND metadata->>'provisionalUpload'='true'
           AND (metadata->>'uploadExpiresAt')::timestamptz>clock_timestamp()
         ${client ? 'FOR UPDATE' : ''}`,
        [id, userId]
      )
    ).rows[0];
    if (!row || !row.metadata.multipart)
      throw new ConflictException('Multipart upload not found or expired');
    return { row, multipart: row.metadata.multipart };
  }

  async presignMultipartPart(id: string, number: number, actor: AuthenticatedRequest) {
    const storage = this.requireMultipartStorage();
    const { row, multipart } = await this.ownedMultipart(id, actor.session.userId);
    const count = Math.ceil(Number(row.file_size) / MULTIPART_PART_SIZE);
    if (multipart.status !== 'in_progress')
      throw new ConflictException('Multipart upload is no longer active');
    if (!Number.isSafeInteger(number) || number < 1 || number > count)
      throw new BadRequestException('Invalid multipart part number');
    return {
      partNumber: number,
      url: await storage.presignedUploadPartUrl!(row.storage_key, multipart.providerId, number),
      expiresIn: DEFAULT_EXPIRES_IN,
    };
  }

  async listMultipartParts(
    id: string,
    actor: AuthenticatedRequest
  ): Promise<{
    key: string;
    partSize: number;
    partCount: number;
    status: 'in_progress' | 'completed' | 'aborted';
    parts: MultipartPart[];
  }> {
    const storage = this.requireMultipartStorage();
    const { row, multipart } = await this.ownedMultipart(id, actor.session.userId);
    return {
      key: row.storage_key,
      partSize: MULTIPART_PART_SIZE,
      partCount: Math.ceil(Number(row.file_size) / MULTIPART_PART_SIZE),
      status: multipart.status,
      parts:
        multipart.status === 'in_progress'
          ? await storage.listMultipartParts!(row.storage_key, multipart.providerId)
          : [],
    };
  }

  async completeMultipart(id: string, actor: AuthenticatedRequest) {
    const storage = this.requireMultipartStorage();
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const { row, multipart } = await this.ownedMultipart(id, actor.session.userId, client);
      if (multipart.status === 'completed') {
        await client.query('COMMIT');
        return { key: row.storage_key, status: 'completed' };
      }
      if (multipart.status !== 'in_progress')
        throw new ConflictException('Multipart upload was aborted');
      const count = Math.ceil(Number(row.file_size) / MULTIPART_PART_SIZE);
      const expectedLast = Number(row.file_size) - (count - 1) * MULTIPART_PART_SIZE;
      let parts;
      try {
        parts = (await storage.listMultipartParts!(row.storage_key, multipart.providerId)).sort(
          (a, b) => a.partNumber - b.partNumber
        );
      } catch (error) {
        // A completed S3 call may have succeeded even if the DB response was lost.
        const object = await storage.getObject(row.storage_key).catch(() => null);
        if (!object || object.contentLength !== Number(row.file_size)) throw error;
        await object.body.cancel();
        parts = null;
      }
      if (parts) {
        if (
          parts.length !== count ||
          parts.some(
            (part, index) =>
              part.partNumber !== index + 1 ||
              part.size !== (index === count - 1 ? expectedLast : MULTIPART_PART_SIZE)
          )
        )
          throw new ConflictException('Multipart parts do not match the authorized file size');
        await storage.completeMultipartUpload!(row.storage_key, multipart.providerId, parts);
      }
      await client.query(
        `UPDATE storage_records SET metadata=jsonb_set(metadata,'{multipart,status}',
          '"completed"'::jsonb),updated_at=NOW() WHERE storage_key=$1`,
        [row.storage_key]
      );
      await client.query('COMMIT');
      return { key: row.storage_key, status: 'completed' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async abortMultipart(id: string, actor: AuthenticatedRequest) {
    const storage = this.requireMultipartStorage();
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const { row, multipart } = await this.ownedMultipart(id, actor.session.userId, client);
      if (multipart.status === 'completed')
        throw new ConflictException('Completed upload cannot be aborted');
      if (multipart.status === 'in_progress')
        await storage.abortMultipartUpload!(row.storage_key, multipart.providerId);
      await client.query(
        `UPDATE storage_records SET metadata=jsonb_set(metadata,'{multipart,status}',
          '"aborted"'::jsonb),updated_at=NOW() WHERE storage_key=$1`,
        [row.storage_key]
      );
      await client.query('COMMIT');
      return { key: row.storage_key, status: 'aborted' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Verify that an object was uploaded successfully and that its
   * detected content type is permitted for its category.
   *
   * Called by the frontend after the browser has PUT the file to the
   * presigned URL. The object's leading bytes are read back from storage
   * and magic-byte detected; the detected content type must be among the
   * effective policy's allowed MIME types:
   * - matches  → `confirmed`;
   * - no match → `type_mismatch` (with the detected type and the allowed
   *   set echoed in the response);
   * - not detected (no signature) → `type_mismatch` (fail closed);
   * - missing object → `not_found`.
   *
   * The category is **not** taken from the request body: it is re-derived
   * from the server-issued object key (`uploads/<category>/<uuid><ext>`,
   * bound at presign time), validated against the known category set, and
   * the endpoint fails closed (400) when the category cannot be resolved.
   * A client therefore cannot skip content-type detection by omitting or
   * loosening `category`.
   */
  async verifyUpload(key: string, actor: AuthenticatedRequest): Promise<VerifyUploadResponse> {
    this.ensureStorageReady();

    // Security: reject keys that try to escape the prefix
    if (!key.startsWith(UPLOAD_PREFIX) || key.includes('..')) {
      throw new BadRequestException('Invalid upload key');
    }

    // Server-side category resolution: `uploads/<category>/<uuid><ext>`
    // was issued by `getPresignedUrl`, which already validated the
    // category against the policy. Fail closed on unknown/missing
    // category instead of silently skipping detection.
    const category = this.resolveCategoryFromKey(key);
    if (category === null) {
      throw new BadRequestException({
        message: 'Invalid upload key: missing or unknown category',
        hint: 'Expected key shape uploads/<category>/<uuid>.<ext>',
      });
    }

    const issued = await requireOwnedUpload(key, actor.session.userId);
    try {
      const inspected = await this.inspectUploadedObject(key, category);

      if (inspected.kind === 'confirmed') {
        const size = parseTrustedContentLength(inspected.contentLength);
        if (
          !size ||
          size !== Number(issued.file_size) ||
          inspected.detected !== issued.content_type
        )
          throw new BadRequestException(
            'Uploaded bytes do not match the authorized size and content type'
          );
        await recordUploadInspection(key, actor.session.userId, {
          contentType: inspected.detected,
          contentLength: size,
          etag: inspected.etag,
          versionId: inspected.versionId,
        });
        return {
          key,
          exists: true,
          status: 'confirmed',
          detectedContentType: inspected.detected,
        };
      }

      return {
        key,
        exists: true,
        status: 'type_mismatch',
        detectedContentType: inspected.detected,
        allowedMimeTypes: [...inspected.allowed],
      };
    } catch (err) {
      if (err instanceof StorageObjectNotFound) {
        return {
          key,
          exists: false,
          status: 'not_found',
        };
      }
      throw err;
    }
  }

  /**
   * Record a completed upload in the storage_records table for immutability tracking.
   *
   * Re-runs object verification so a direct API client cannot create an
   * `active` record independently of the verify seam. Persists the
   * object's trusted storage Content-Length (not a client-declared
   * size), uploader identity, and optional intended purpose.
   */
  async recordUpload(
    key: string,
    raw: unknown,
    req: AuthenticatedRequest
  ): Promise<{ key: string; status: string }> {
    this.ensureStorageReady();
    this.ensureImmutableServiceReady();
    const parsed = RecordUploadRequestSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException('Invalid upload record request');
    const body = parsed.data;

    if (!key.startsWith(UPLOAD_PREFIX) || key.includes('..')) {
      throw new BadRequestException('Invalid upload key');
    }

    const category = this.resolveCategoryFromKey(key);
    if (category === null) {
      throw new BadRequestException({
        message: 'Invalid upload key: missing or unknown category',
        hint: 'Expected key shape uploads/<category>/<uuid>.<ext>',
      });
    }

    const issued = await requireOwnedUpload(key, req.session.userId);
    const reserved = (issued.metadata.uploadContext ?? {}) as Record<string, unknown>;
    const context = UploadContextSchema.safeParse({
      purpose: body.purpose ?? reserved.purpose ?? issued.metadata.purpose,
      profileId: body.profileId ?? reserved.profileId ?? issued.metadata.profileId,
    });
    if (!context.success) throw new BadRequestException('Invalid upload association');
    for (const field of ['purpose', 'profileId'] as const) {
      if (reserved[field] !== undefined && reserved[field] !== context.data[field])
        throw new ConflictException('Upload was authorized for a different purpose or profile');
    }
    await requireUploadContext(this.profilesService, req, context.data);
    if (issued.status === 'active') {
      if (
        (body.purpose !== undefined && body.purpose !== issued.metadata.purpose) ||
        (body.profileId !== undefined && body.profileId !== issued.metadata.profileId)
      )
        throw new ConflictException(
          'The upload is already recorded for a different purpose or profile'
        );
      return { key, status: 'recorded' };
    }
    let detectedContentType: string;
    let actualFileSize: number;
    try {
      const inspected = await this.inspectUploadedObject(key, category);
      if (inspected.kind !== 'confirmed') {
        throw new BadRequestException({
          message: 'Upload must be verified before it can be recorded',
          status: inspected.kind,
        });
      }
      detectedContentType = inspected.detected;
      const trustedSize = parseTrustedContentLength(inspected.contentLength);
      if (trustedSize === null || trustedSize === 0) {
        throw new BadRequestException({
          message: 'Uploaded object size could not be determined from storage',
        });
      }
      if (body.fileSize !== undefined && body.fileSize !== null) {
        if (
          typeof body.fileSize !== 'number' ||
          !Number.isSafeInteger(body.fileSize) ||
          body.fileSize !== trustedSize
        ) {
          throw new BadRequestException({
            message: 'Declared file size does not match the uploaded object',
            declaredBytes: body.fileSize,
            actualBytes: trustedSize,
          });
        }
      }
      if (trustedSize !== Number(issued.file_size) || detectedContentType !== issued.content_type) {
        throw new BadRequestException(
          'Uploaded bytes do not match the authorized size and content type'
        );
      }
      const policy = await this.policyResolver.resolveEffective(category);
      if (!effectiveAllowsSize(policy, trustedSize)) {
        throw new BadRequestException({
          message: `File size exceeds maximum of ${policy.maxSizeBytes / (1024 * 1024)} MB for category "${category}"`,
          maxSizeBytes: policy.maxSizeBytes,
          actualBytes: trustedSize,
          policySource: policy.source,
        });
      }
      actualFileSize = trustedSize;
      await recordUploadInspection(key, req.session.userId, {
        contentType: detectedContentType,
        contentLength: actualFileSize,
        etag: inspected.etag,
        versionId: inspected.versionId,
      });
    } catch (err) {
      if (err instanceof StorageObjectNotFound) {
        throw new BadRequestException({
          message: 'Upload must be verified before it can be recorded',
          status: 'not_found',
        });
      }
      throw err;
    }

    const { purpose, profileId } = context.data;
    await requireUploadContext(this.profilesService, req, context.data);

    await completeUpload({
      storageKey: key,
      fileName: body.fileName,
      contentType: detectedContentType,
      fileSize: actualFileSize,
      category,
      metadata: {
        verified: true,
        verifiedAt: new Date().toISOString(),
        // T-05.11.02 explicitly permits availability when no scanner is configured.
        // The future scanner integration must replace this branch, never claim a pass on failure.
        scanState: 'Available',
        scanSkippedReason: 'not_configured',
        scanResolvedAt: new Date().toISOString(),
        uploadedBy: req.session.userId,
        ...(profileId ? { profileId } : {}),
        ...(purpose ? { purpose } : {}),
      },
    });

    return { key, status: 'recorded' };
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /** Re-read all verified bytes under the current category policy before making an immutable copy. */
  async readVerifiedUpload(key: string, userId: string) {
    this.ensureStorageReady();
    const category = this.resolveCategoryFromKey(key);
    if (!category) throw new BadRequestException('Invalid upload key');
    const issued = await requireOwnedUpload(key, userId);
    if (issued.status !== 'active' || issued.metadata.verified !== true)
      throw new ConflictException('Upload must be verified before it can be attached');
    const inspected = await this.inspectUploadedObject(key, category, true);
    if (
      inspected.kind !== 'confirmed' ||
      !inspected.bytes ||
      inspected.bytes.length !== Number(issued.file_size) ||
      inspected.detected !== issued.content_type
    )
      throw new ConflictException('Upload content changed after verification');
    return {
      bytes: inspected.bytes,
      contentType: inspected.detected,
      category,
      metadata: issued.metadata,
    };
  }

  /**
   * Re-read the object and magic-byte sniff it against the category
   * bound into the key. Throws {@link StorageObjectNotFound} when the
   * object is missing; callers map that to `not_found`.
   */
  private async inspectUploadedObject(
    key: string,
    category: string,
    includeBytes = false
  ): Promise<
    | {
        kind: 'confirmed';
        detected: string;
        contentLength: number | undefined;
        etag: string | undefined;
        versionId: string | undefined;
        bytes?: Uint8Array;
      }
    | { kind: 'type_mismatch'; detected: string | null; allowed: readonly string[] }
  > {
    const policy = await this.policyResolver.resolveEffective(category);
    if (!effectiveAllowsExtension(policy, key))
      throw new BadRequestException('Upload extension is no longer permitted by the active policy');
    const object = await this.storage!.getObject(key);
    const storedSize = parseTrustedContentLength(object.contentLength);
    if (!storedSize || !effectiveAllowsSize(policy, storedSize)) {
      await object.body.cancel();
      throw new BadRequestException(
        'Uploaded object size is unavailable or exceeds the active limit'
      );
    }
    const office = /\.(docx?|xlsx?)$/i.test(key);
    const csv = /\.csv$/i.test(key);
    const sample = await this.readSample(
      object.body,
      office || csv || includeBytes ? policy.maxSizeBytes : SNIFF_SAMPLE_BYTES,
      office || csv || includeBytes
    );
    let candidates: string[];
    if (office || csv) {
      // These formats need complete content inspection, rather than a leading signature.
      const mime = await detectDocumentContentType(sample, csv ? 'csv' : 'office');
      candidates = mime ? [mime] : [];
    } else {
      candidates = sniffContentTypes(sample);
    }
    const allowedMimeTypes = effectiveMimeTypesForFile(policy, key);
    const detected = pickDetectedContentType(candidates, allowedMimeTypes);
    if (detected !== null) {
      return {
        kind: 'confirmed',
        detected,
        contentLength: object.contentLength,
        etag: object.etag,
        versionId: object.versionId,
        ...(includeBytes ? { bytes: sample } : {}),
      };
    }
    return {
      kind: 'type_mismatch',
      detected: candidates[0] ?? null,
      allowed: allowedMimeTypes,
    };
  }

  /**
   * Extract the category bound into a server-issued upload key of shape
   * `uploads/<category>/<uuid><ext>`. Returns null when the key does not
   * start with the upload prefix, has no category segment, carries path
   * traversal, or the category is not a known upload category — so the
   * caller can fail closed instead of guessing. Self-defending: does not
   * rely on the caller having pre-validated the key.
   */
  private resolveCategoryFromKey(key: string): string | null {
    if (!key.startsWith(UPLOAD_PREFIX) || key.includes('..')) return null;
    const rest = key.slice(UPLOAD_PREFIX.length);
    const slash = rest.indexOf('/');
    if (slash === -1) return null;
    const category = rest.slice(0, slash);
    // Exactly one more segment (the file name) must follow the category.
    // `uploads/document/a/b.pdf` or `uploads/document/` is not a key the
    // server issues — reject rather than pass an unexpected path shape
    // to the storage provider.
    const remainder = rest.slice(slash + 1);
    if (remainder.length === 0 || remainder.includes('/')) return null;
    return UPLOAD_CATEGORIES.includes(category) ? category : null;
  }

  /**
   * Read a signature sample, or an entire document within the active
   * size limit. Complete reads reject excess bytes even if storage metadata
   * understates the length. Always release the response stream.
   */
  private async readSample(
    stream: ReadableStream,
    limit = SNIFF_SAMPLE_BYTES,
    requireComplete = false
  ): Promise<Uint8Array> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          if (requireComplete && total + value.byteLength > limit)
            throw new BadRequestException('Uploaded file exceeds the active size limit');
          chunks.push(value);
          total += value.byteLength;
          if (!requireComplete && total >= limit) break;
        }
      }
    } finally {
      // Cancel the stream so the storage provider tears down the unused
      // body (cancelling also releases the reader lock). Swallow errors:
      // the sample has already been read and a failed teardown must not
      // turn a successful verification into a 500.
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const sample = new Uint8Array(Math.min(total, limit));
    let written = 0;
    for (const chunk of chunks) {
      const take = Math.min(chunk.byteLength, sample.length - written);
      sample.set(chunk.subarray(0, take), written);
      written += take;
      if (written >= sample.length) break;
    }
    return sample;
  }

  private ensureStorageReady(): void {
    if (!this.storage) {
      throw new ServiceUnavailableException(
        'Storage service is not configured. Set S3_BUCKET and S3_REGION environment variables.'
      );
    }
  }

  private ensureImmutableServiceReady(): void {
    if (!this.immutableStorageService) {
      throw new ServiceUnavailableException(
        'Immutable storage service is not configured. Storage provider must be enabled.'
      );
    }
  }
}

function parseTrustedContentLength(contentLength: number | undefined): number | null {
  if (
    typeof contentLength !== 'number' ||
    !Number.isSafeInteger(contentLength) ||
    contentLength < 0
  ) {
    return null;
  }
  return contentLength;
}
