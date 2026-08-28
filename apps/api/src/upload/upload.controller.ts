import {
  Controller,
  Inject,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  ServiceUnavailableException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { StorageProvider } from '@barghsa/shared/storage';
import { StorageObjectNotFound, type ImmutableStorageRecordService } from '@barghsa/shared/storage';
import { STORAGE_PROVIDER, IMMUTABLE_STORAGE_SERVICE } from '../storage/index.js';
import {
  PresignedUrlRequestSchema,
  type PresignedUrlRequest,
  type PresignedUrlResponse,
  type VerifyUploadResponse,
} from './upload.types.js';
import {
  getCategoryDescriptions,
  resolveCategory,
} from './upload.config.js';
import {
  UploadPolicyResolver,
  effectiveAllowsExtension,
  effectiveAllowsMime,
  effectiveAllowsSize,
} from './upload-policy.resolver.js';
import { pickDetectedContentType, sniffContentTypes, SNIFF_SAMPLE_BYTES } from './content-type-sniffer.js';

const UPLOAD_PREFIX = 'uploads/';
const DEFAULT_EXPIRES_IN = 3600; // 1 hour

@Controller('api/upload')
export class UploadController {
  constructor(
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProvider | null,
    @Inject(IMMUTABLE_STORAGE_SERVICE)
    private readonly immutableStorageService: ImmutableStorageRecordService | null,
    @Inject(UploadPolicyResolver)
    private readonly policyResolver: UploadPolicyResolver,
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
  @Post('presigned-url')
  @HttpCode(HttpStatus.OK)
  async getPresignedUrl(
    @Body() raw: unknown,
  ): Promise<PresignedUrlResponse> {
    this.ensureStorageReady();

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
    if (!effectiveAllowsMime(policy, req.contentType)) {
      throw new BadRequestException({
        message: `Content type "${req.contentType}" not allowed for category "${category}"`,
        allowedMimeTypes: policy.allowedMimeTypes,
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

    // Generate a unique key
    const ext = (req.fileName.includes('.')
      ? req.fileName.slice(req.fileName.lastIndexOf('.')).toLowerCase()
      : '');
    const uniqueKey = `${UPLOAD_PREFIX}${randomUUID()}${ext}`;

    try {
      const presignedUrl = await this.storage!.presignedPutUrl(
        uniqueKey,
        DEFAULT_EXPIRES_IN,
      );

      return {
        key: uniqueKey,
        presignedUrl,
        expiresIn: DEFAULT_EXPIRES_IN,
      };
    } catch (err) {
      throw new InternalServerErrorException(
        'Failed to generate presigned URL',
        { cause: err },
      );
    }
  }

  /**
   * Verify that an object was uploaded successfully and mark it pending scan.
   *
   * Called by the frontend after the browser has PUT the file to the
   * presigned URL so the API records the metadata and schedules a scan.
   *
   * Since T-09.12.05, when the caller supplies the upload `category`, the
   * object's leading bytes are read back from storage and magic-byte
   * detected; the detected content type must be among the effective
   * policy's allowed MIME types:
   * - matches  → `confirmed`;
   * - no match → `type_mismatch` (with the detected type and the allowed
   *   set echoed in the response);
   * - not sniffable / no category → legacy `pending_scan` (no detection,
   *   backward compatible).
   */
  @Post(':key/verify')
  @HttpCode(HttpStatus.OK)
  async verifyUpload(
    @Param('key') key: string,
    @Body() body?: { category?: string },
  ): Promise<VerifyUploadResponse> {
    this.ensureStorageReady();

    // Security: reject keys that try to escape the prefix
    if (!key.startsWith(UPLOAD_PREFIX) || key.includes('..')) {
      throw new BadRequestException('Invalid upload key');
    }

    try {
      const object = await this.storage!.getObject(key);
      const category = body?.category;

      // Legacy path: no category → existence check only. Also covers
      // categories where no detection is possible (no bytes).
      if (!category) {
        return {
          key,
          exists: true,
          status: 'pending_scan',
        };
      }

      const policy = await this.policyResolver.resolveEffective(category);
      const sample = await this.readSample(object.body);
      const candidates = sniffContentTypes(sample);
      const detected = pickDetectedContentType(candidates, policy.allowedMimeTypes);

      if (detected !== null) {
        return {
          key,
          exists: true,
          status: 'confirmed',
          detectedContentType: detected,
        };
      }

      return {
        key,
        exists: true,
        status: 'type_mismatch',
        detectedContentType: candidates[0] ?? null,
        allowedMimeTypes: policy.allowedMimeTypes,
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
   * Should be called after upload is complete and verified. Creates a
   * `storage_records` entry with status `active` so the object can
   * later be signed/approved (marked immutable) or deleted.
   */
  @Post(':key/record')
  @HttpCode(HttpStatus.OK)
  async recordUpload(
    @Param('key') key: string,
    @Body() body: { fileName?: string; contentType?: string; fileSize?: number; category?: string },
  ): Promise<{ key: string; status: string }> {
    this.ensureStorageReady();
    this.ensureImmutableServiceReady();

    if (!key.startsWith(UPLOAD_PREFIX) || key.includes('..')) {
      throw new BadRequestException('Invalid upload key');
    }

    await this.immutableStorageService!.createRecord({
      storageKey: key,
      fileName: body.fileName,
      contentType: body.contentType,
      fileSize: body.fileSize,
      category: body.category ?? resolveCategory(body.fileName) ?? 'general',
    });

    return { key, status: 'recorded' };
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Read up to {@link SNIFF_SAMPLE_BYTES} leading bytes from a web
   * ReadableStream, then cancel it (the verify seam only needs the
   * signature). Never buffers the whole object.
   */
  private async readSample(stream: ReadableStream): Promise<Uint8Array> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          total += value.byteLength;
          if (total >= SNIFF_SAMPLE_BYTES) break;
        }
      }
    } finally {
      reader.releaseLock();
    }
    const sample = new Uint8Array(Math.min(total, SNIFF_SAMPLE_BYTES));
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
        'Storage service is not configured. Set S3_BUCKET and S3_REGION environment variables.',
      );
    }
  }

  private ensureImmutableServiceReady(): void {
    if (!this.immutableStorageService) {
      throw new ServiceUnavailableException(
        'Immutable storage service is not configured. Storage provider must be enabled.',
      );
    }
  }
}