import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  bindUploadProfile,
  reserveUpload,
  requireOwnedUpload,
  completeUpload,
  queueUploadScan,
  recordUploadInspection,
} from './upload-reservations.js';
import { randomUUID } from 'node:crypto';
import { createDirectDbPool, getDbPool } from '@barghsa/db';
import { withMultipartUploadLock, finishMultipartReservation } from '@barghsa/db/storage-multipart';
import { rateLimitKey } from '@barghsa/shared/rate-limit';
import type { PoolClient } from 'pg';
import { requireCurrentSession } from '../session/session-step-up.js';
import { renderPdfFirstPage } from '../documents/document-preview.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { requireUploadContext } from './upload-access.js';
import { detectDocumentContentType } from './document-content-type.js';
import type { MultipartPart, StorageProvider } from '@barghsa/shared/storage';
import {
  MULTIPART_PART_SIZE,
  validMultipartParts,
  finishMultipartUpload,
  type MultipartUploadState,
} from '@barghsa/shared/storage';
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
const DEFAULT_EXPIRES_IN = 900; // 15 minutes
const MULTIPART_EXPIRES_IN = 24 * 3600;
const UPLOAD_REQUESTS_PER_MINUTE = 20;

type MultipartRecord = {
  storage_key: string;
  file_size: string;
  content_type: string;
  metadata: {
    multipart?: MultipartUploadState;
    uploadExpiresAt?: string;
    uploadContext?: { operatingContext?: 'staff' | 'customer' };
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
    @Inject(ProfilesService) private readonly profilesService: ProfilesService,
    @Inject(RateLimitService) private readonly rateLimits: RateLimitService
  ) {}

  /** Public constraints only; this read neither reserves a file nor grants record access. */
  async filePolicy(category: string) {
    if (!['document', 'image', 'video', 'contract'].includes(category))
      throw new BadRequestException('Unknown file category');
    const policy = await this.policyResolver.resolveEffective(category);
    const formats = (policy.allowedExtensions ?? [])
      .map((extension) => ({
        extension,
        mimeTypes: effectiveMimeTypesForFile(policy, 'file' + extension),
      }))
      .filter((format) => format.mimeTypes.length > 0);
    return { category, formats, maxSizeBytes: policy.maxSizeBytes };
  }

  /** Transient preview only: no reservation, original object, or derivative is stored. */
  async pdfPreview(bytes: Buffer, actor: AuthenticatedRequest) {
    if (
      !bytes.length ||
      bytes.length > 10 * 1024 * 1024 ||
      !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))
    )
      throw new BadRequestException('Invalid PDF preview input');
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const account = (
        await client.query(
          'SELECT disabled_at,activation_token FROM users WHERE user_id=$1 FOR NO KEY UPDATE',
          [actor.session.userId]
        )
      ).rows[0];
      if (!account || account.disabled_at || account.activation_token)
        throw new ForbiddenException('Preview is unavailable');
      await requireCurrentSession(client, actor.session);
      let image: Buffer;
      try {
        image = await renderPdfFirstPage(bytes);
      } catch {
        throw new ServiceUnavailableException('Preview is unavailable');
      }
      await requireCurrentSession(client, actor.session);
      await client.query('COMMIT');
      return image;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

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
    if (
      req.purpose === 'conversation_avatar' &&
      (category !== 'image' ||
        req.fileSize > 2 * 1024 * 1024 ||
        !['image/png', 'image/jpeg', 'image/webp'].includes(req.contentType))
    )
      throw new BadRequestException(
        'Conversation photos must be PNG, JPG or WebP images up to 2 MB'
      );

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

    const quotaKey = req.profileId
      ? rateLimitKey('upload:profile', req.profileId.toLowerCase())
      : rateLimitKey('upload:user', actor.session.userId);
    await this.rateLimits.enforceSecurityRateLimit(quotaKey, UPLOAD_REQUESTS_PER_MINUTE, 60_000);

    // Generate a unique key. The (already validated) category is bound
    // into the key — `uploads/<category>/<uuid><ext>` — so the verify
    // seam can re-derive it server-side instead of trusting a
    // client-supplied body field (T-09.12.05). General uploads may have
    // arbitrary names, so only a single safe extension goes into the key.
    const ext = req.fileName.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() ?? '';
    const uniqueKey = `${UPLOAD_PREFIX}${category}/${randomUUID()}${ext}`;

    await reserveUpload({
      key: uniqueKey,
      userId: actor.session.userId,
      fileName: req.fileName,
      contentType: req.contentType,
      fileSize: req.fileSize,
      category,
      expiresIn,
      context: {
        purpose: req.purpose,
        profileId: req.profileId,
        ticketId: req.ticketId,
        operatingContext: actor.session.operatingContext,
      },
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

  async getMultipartUpload(
    raw: unknown,
    actor: AuthenticatedRequest,
    options: { initialize?: boolean } = {}
  ) {
    this.requireMultipartStorage();
    const parsed = PresignedUrlRequestSchema.safeParse(raw);
    if (!parsed.success || parsed.data.fileSize <= MULTIPART_PART_SIZE)
      throw new BadRequestException('Multipart upload requires a file larger than 5 MiB');
    const key = await this.reserveNewUpload(raw, actor, MULTIPART_EXPIRES_IN);
    return {
      ...(await this.startMultipartForKey(key, actor.session.userId, options)),
      expiresIn: MULTIPART_EXPIRES_IN,
    };
  }

  /** Reuse an existing owned reservation, including document-specific reservations. */
  async startMultipartForKey(key: string, userId: string, options: { initialize?: boolean } = {}) {
    const storage = this.requireMultipartStorage();
    return this.runMultipartOperation(key, async (client) => {
      const row = (
        await client.query<MultipartRecord>(
          `SELECT storage_key,file_size,content_type,metadata FROM storage_records
           WHERE storage_key=$1 AND metadata->>'uploadedBy'=$2 AND status='removed'
             AND signed_at IS NULL AND metadata->>'provisionalUpload'='true'
             AND metadata->>'deletionRequested'='true'
             AND (metadata->>'uploadExpiresAt')::timestamptz>clock_timestamp()
           `,
          [key, userId]
        )
      ).rows[0];
      if (!row) throw new ConflictException('Upload reservation is unavailable');
      if (Number(row.file_size) <= MULTIPART_PART_SIZE)
        throw new BadRequestException('Multipart upload requires a file larger than 5 MiB');
      let multipart = row.metadata.multipart;
      if (!multipart) {
        multipart = { id: randomUUID(), status: 'starting' };
        const claimed = await client.query(
          `UPDATE storage_records SET metadata=jsonb_set(metadata,'{multipart}',$2::jsonb,true),
            updated_at=NOW() WHERE storage_key=$1 AND status='removed' AND signed_at IS NULL
              AND metadata->'multipart' IS NULL
              AND (metadata->>'uploadExpiresAt')::timestamptz>clock_timestamp()`,
          [key, JSON.stringify(multipart)]
        );
        if (claimed.rowCount !== 1) throw new ConflictException('Upload reservation changed');
      }
      if (multipart.status === 'starting' && options.initialize !== false) {
        const providerId = await storage.createMultipartUpload!(key, row.content_type);
        const selected = await client.query(
          `UPDATE storage_records SET metadata=jsonb_set(metadata,'{multipart}',$3::jsonb),
             updated_at=NOW()
           WHERE storage_key=$1 AND metadata->'multipart'->>'id'=$2 AND status='removed'
             AND signed_at IS NULL AND metadata->'multipart'->>'status'='starting'
             AND (metadata->>'uploadExpiresAt')::timestamptz>clock_timestamp()`,
          [key, multipart.id, JSON.stringify({ ...multipart, providerId, status: 'in_progress' })]
        );
        if (selected.rowCount !== 1)
          throw new ConflictException('Upload reservation changed during initialization');
        multipart = { ...multipart, providerId, status: 'in_progress' };
      }
      const active =
        multipart.status === 'in_progress' ||
        (multipart.status === 'starting' && options.initialize === false);
      if (!active) throw new ConflictException('Multipart upload is no longer active');
      return {
        uploadId: multipart.id,
        key,
        partSize: MULTIPART_PART_SIZE,
        partCount: Math.ceil(Number(row.file_size) / MULTIPART_PART_SIZE),
        expiresAt: row.metadata.uploadExpiresAt,
      };
    });
  }

  private async runMultipartOperation<T>(
    key: string,
    work: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const result = await withMultipartUploadLock(createDirectDbPool(), key, work);
    if (!result.acquired) throw new ConflictException('Multipart operation is already running');
    return result.value;
  }

  private requireReservationContext(
    metadata: Record<string, unknown>,
    actor: AuthenticatedRequest
  ) {
    const reserved = metadata.uploadContext;
    if (
      reserved &&
      typeof reserved === 'object' &&
      'operatingContext' in reserved &&
      reserved.operatingContext !== undefined &&
      reserved.operatingContext !== actor.session.operatingContext
    )
      throw new ForbiddenException('Upload belongs to another operating context');
  }

  private async ownedMultipart(
    id: string,
    actor: AuthenticatedRequest,
    client?: PoolClient,
    recovering: Array<'completing' | 'aborting'> = []
  ) {
    const row = (
      await (client ?? getDbPool()).query<MultipartRecord>(
        `SELECT storage_key,file_size,content_type,metadata FROM storage_records
         WHERE metadata->'multipart'->>'id'=$1 AND metadata->>'uploadedBy'=$2
           AND status='removed' AND signed_at IS NULL
           AND metadata->>'provisionalUpload'='true' AND metadata->>'deletionRequested'='true'
           AND ((metadata->>'uploadExpiresAt')::timestamptz>clock_timestamp()
                OR metadata->'multipart'->>'status'=ANY($3::text[]))`,
        [id, actor.session.userId, recovering]
      )
    ).rows[0];
    if (!row || !row.metadata.multipart?.providerId)
      throw new ConflictException('Multipart upload not found or expired');
    this.requireReservationContext(row.metadata, actor);
    return {
      row,
      multipart: { ...row.metadata.multipart, providerId: row.metadata.multipart.providerId },
    };
  }

  async presignMultipartPart(id: string, number: number, actor: AuthenticatedRequest) {
    const storage = this.requireMultipartStorage();
    const { row, multipart } = await this.ownedMultipart(id, actor);
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
    status: 'in_progress' | 'completing' | 'completed' | 'aborting' | 'aborted';
    parts: MultipartPart[];
  }> {
    const storage = this.requireMultipartStorage();
    const { row, multipart } = await this.ownedMultipart(id, actor);
    return {
      key: row.storage_key,
      partSize: MULTIPART_PART_SIZE,
      partCount: Math.ceil(Number(row.file_size) / MULTIPART_PART_SIZE),
      status: multipart.status === 'starting' ? 'in_progress' : multipart.status,
      parts:
        multipart.status === 'in_progress'
          ? await storage.listMultipartParts!(row.storage_key, multipart.providerId)
          : [],
    };
  }

  async completeMultipart(id: string, actor: AuthenticatedRequest) {
    const storage = this.requireMultipartStorage();
    const owned = await this.ownedMultipart(id, actor, undefined, ['completing']);
    return this.runMultipartOperation(owned.row.storage_key, async (client) => {
      const { row, multipart } = await this.ownedMultipart(id, actor, client, ['completing']);
      if (multipart.status === 'completed') return { key: row.storage_key, status: 'completed' };
      if (!['in_progress', 'completing'].includes(multipart.status))
        throw new ConflictException('Multipart upload was aborted');
      let parts: MultipartPart[] | undefined;
      try {
        parts = (await storage.listMultipartParts!(row.storage_key, multipart.providerId)).sort(
          (a, b) => a.partNumber - b.partNumber
        );
      } catch (error) {
        // A completed S3 call may have succeeded even if the DB response was lost.
        const object = await storage.getObject(row.storage_key).catch(() => null);
        if (!object) throw error;
        const matches = object.contentLength === Number(row.file_size);
        await object.body.cancel();
        if (!matches) throw error;
      }
      if (parts && !validMultipartParts(parts, Number(row.file_size)))
        throw new ConflictException('Multipart parts do not match the authorized file size');
      const claimed = await client.query(
        `UPDATE storage_records SET metadata=jsonb_set(metadata,'{multipart}',$3::jsonb),updated_at=NOW()
         WHERE storage_key=$1 AND metadata->'multipart'->>'id'=$2
           AND status='removed' AND signed_at IS NULL
           AND metadata->'multipart'->>'status' IN ('in_progress','completing')
           AND ((metadata->>'uploadExpiresAt')::timestamptz>clock_timestamp()
                OR metadata->'multipart'->>'status'='completing')`,
        [row.storage_key, id, JSON.stringify({ ...multipart, status: 'completing', parts })]
      );
      if (claimed.rowCount !== 1) throw new ConflictException('Upload reservation changed');
      await finishMultipartUpload(
        storage,
        row.storage_key,
        multipart.providerId,
        parts,
        Number(row.file_size)
      );
      if (
        !(await finishMultipartReservation(
          client,
          row.storage_key,
          multipart.providerId,
          'completed'
        ))
      )
        throw new ConflictException('Upload reservation changed during completion');
      return { key: row.storage_key, status: 'completed' };
    });
  }

  async abortMultipart(id: string, actor: AuthenticatedRequest) {
    const storage = this.requireMultipartStorage();
    const owned = await this.ownedMultipart(id, actor, undefined, ['completing', 'aborting']);
    return this.runMultipartOperation(owned.row.storage_key, async (client) => {
      const { row, multipart } = await this.ownedMultipart(id, actor, client, [
        'completing',
        'aborting',
      ]);
      if (multipart.status === 'completed')
        throw new ConflictException('Completed upload cannot be aborted');
      if (multipart.status === 'aborted') return { key: row.storage_key, status: 'aborted' };
      const claimed = await client.query(
        `UPDATE storage_records SET metadata=jsonb_set(metadata,'{multipart,status}',
          '"aborting"'::jsonb),updated_at=NOW() WHERE storage_key=$1
           AND metadata->'multipart'->>'id'=$2 AND status='removed' AND signed_at IS NULL
           AND metadata->'multipart'->>'status' IN ('in_progress','completing','aborting')`,
        [row.storage_key, id]
      );
      if (claimed.rowCount !== 1) throw new ConflictException('Upload reservation changed');
      await storage.abortMultipartUpload!(row.storage_key, multipart.providerId);
      if (
        !(await finishMultipartReservation(
          client,
          row.storage_key,
          multipart.providerId,
          'aborted'
        ))
      )
        throw new ConflictException('Upload reservation changed during abort');
      return { key: row.storage_key, status: 'aborted' };
    });
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
    this.requireReservationContext(issued.metadata, actor);
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
  ): Promise<
    { key: string; status: 'recorded' } | { key: string; status: 'pending_scan'; jobId: string }
  > {
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
    this.requireReservationContext(issued.metadata, req);
    const reserved = (issued.metadata.uploadContext ?? {}) as Record<string, unknown>;
    const context = UploadContextSchema.safeParse({
      purpose: body.purpose ?? reserved.purpose ?? issued.metadata.purpose,
      profileId: body.profileId ?? reserved.profileId ?? issued.metadata.profileId,
      ticketId: body.ticketId ?? reserved.ticketId ?? issued.metadata.ticketId,
    });
    if (!context.success) throw new BadRequestException('Invalid upload association');
    for (const field of ['purpose', 'profileId', 'ticketId'] as const) {
      if (reserved[field] !== undefined && reserved[field] !== context.data[field])
        throw new ConflictException('Upload was authorized for a different purpose or profile');
    }
    await requireUploadContext(this.profilesService, req, context.data);
    const { purpose, profileId, ticketId } = context.data;
    const existingScan =
      typeof issued.metadata.scanJobId === 'string' ? issued.metadata.scanJobId : undefined;
    if (existingScan) {
      const bound = issued.metadata.scanContext as typeof context.data | undefined;
      if (
        !bound ||
        (['purpose', 'profileId', 'ticketId'] as const).some(
          (field) => bound[field] !== context.data[field]
        )
      )
        throw new ConflictException('Upload was recorded for a different scan purpose or profile');
    }
    // Business documents enqueue their own scan of an immutable copy at confirmation.
    const scanRequired =
      Boolean(existingScan || process.env['DOCUMENT_CLAMAV_HOST']?.trim()) &&
      purpose !== 'business_document' &&
      purpose !== 'staff_business_document';
    const scanJobId = scanRequired ? existingScan : undefined;
    if (issued.status === 'active') {
      if (
        (body.purpose !== undefined && body.purpose !== issued.metadata.purpose) ||
        (body.profileId !== undefined && body.profileId !== issued.metadata.profileId) ||
        (body.ticketId !== undefined && body.ticketId !== issued.metadata.ticketId)
      )
        throw new ConflictException(
          'The upload is already recorded for a different purpose or profile'
        );
      if (!scanRequired) return { key, status: 'recorded' };
    }
    if (scanJobId) {
      if (issued.metadata.scanState === 'Quarantined')
        throw new BadRequestException('This file cannot be accepted. Please upload a replacement.');
      if (issued.metadata.scanState === 'Pending scan')
        return { key, status: 'pending_scan', jobId: scanJobId };
      if (
        issued.metadata.scanState !== 'Available' ||
        typeof issued.metadata.scanSha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(issued.metadata.scanSha256)
      )
        throw new ConflictException('Upload scan receipt is unavailable');
      if (issued.status === 'active') return { key, status: 'recorded' };
    }
    let detectedContentType: string;
    let actualFileSize: number;
    let inspection: {
      contentLength: number;
      etag: string | undefined;
      versionId: string | undefined;
    };
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
      inspection = {
        contentLength: actualFileSize,
        etag: inspected.etag,
        versionId: inspected.versionId,
      };
      if (!scanRequired)
        await recordUploadInspection(key, req.session.userId, {
          contentType: detectedContentType,
          ...inspection,
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

    if (
      purpose === 'conversation_avatar' &&
      (category !== 'image' ||
        actualFileSize > 2 * 1024 * 1024 ||
        !['image/png', 'image/jpeg', 'image/webp'].includes(detectedContentType))
    )
      throw new BadRequestException(
        'Conversation photos must be PNG, JPG or WebP images up to 2 MB'
      );
    await requireUploadContext(this.profilesService, req, context.data);

    if (scanRequired && !inspection.etag && !inspection.versionId)
      throw new ServiceUnavailableException('Storage object identity is unavailable for scanning');
    if (profileId && !reserved.profileId && !issued.metadata.profileId && !existingScan) {
      await this.rateLimits.enforceSecurityRateLimit(
        rateLimitKey('upload:profile', profileId.toLowerCase()),
        UPLOAD_REQUESTS_PER_MINUTE,
        60_000
      );
      await bindUploadProfile(key, req.session.userId, profileId);
    }

    if (scanRequired) {
      if (!scanJobId) {
        const jobId = await queueUploadScan({
          key,
          userId: req.session.userId,
          operatingContext: req.session.operatingContext,
          context: context.data,
          inspection,
        });
        return { key, status: 'pending_scan', jobId };
      }
      const scanned = issued.metadata.storageInspection as typeof inspection | undefined;
      if (
        scanned?.contentLength !== inspection.contentLength ||
        scanned.etag !== inspection.etag ||
        scanned.versionId !== inspection.versionId
      )
        throw new ConflictException('Upload changed after scanning');
    }

    await completeUpload(
      {
        storageKey: key,
        fileName: body.fileName,
        contentType: detectedContentType,
        fileSize: actualFileSize,
        category,
        metadata: {
          verified: true,
          verifiedAt: new Date().toISOString(),
          ...(scanRequired
            ? {}
            : {
                scanState: 'Available',
                scanSkippedReason: 'not_configured',
                scanResolvedAt: new Date().toISOString(),
              }),
          uploadedBy: req.session.userId,
          ...(profileId ? { profileId } : {}),
          ...(purpose ? { purpose } : {}),
          ...(ticketId ? { ticketId } : {}),
        },
      },
      scanJobId
    );

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
