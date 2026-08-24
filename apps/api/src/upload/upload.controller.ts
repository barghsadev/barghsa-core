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
import { StorageObjectNotFound } from '@barghsa/shared/storage';
import { STORAGE_PROVIDER } from '../storage/index.js';
import {
  PresignedUrlRequestSchema,
  type PresignedUrlRequest,
  type PresignedUrlResponse,
  type VerifyUploadResponse,
} from './upload.types.js';
import {
  isAllowedExtension,
  isAllowedMimeType,
  getMaxSizeBytes,
  resolveCategory,
  getCategoryDescriptions,
} from './upload.config.js';

const UPLOAD_PREFIX = 'uploads/';
const DEFAULT_EXPIRES_IN = 3600; // 1 hour

@Controller('api/upload')
export class UploadController {
  constructor(
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProvider | null,
  ) {}

  /**
   * Generate a presigned PUT URL for direct browser-to-S3 upload.
   *
   * Validates file type, size, and permissions before returning the URL.
   * The API never proxies file bodies — only metadata.
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

    // Validate file extension
    if (!isAllowedExtension(req.fileName, category)) {
      const cfg = getCategoryDescriptions();
      throw new BadRequestException({
        message: `File type not allowed for category "${category}"`,
        allowedExtensions: cfg[category]?.allowedExtensions ?? 'any',
      });
    }

    // Validate MIME type
    if (!isAllowedMimeType(req.contentType, category)) {
      throw new BadRequestException({
        message: `Content type "${req.contentType}" not allowed for category "${category}"`,
      });
    }

    // Validate file size
    const maxSize = getMaxSizeBytes(category);
    if (req.fileSize > maxSize) {
      throw new BadRequestException({
        message: `File size exceeds maximum of ${maxSize / (1024 * 1024)} MB for category "${category}"`,
        maxSizeBytes: maxSize,
        actualBytes: req.fileSize,
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
   */
  @Post(':key/verify')
  @HttpCode(HttpStatus.OK)
  async verifyUpload(
    @Param('key') key: string,
  ): Promise<VerifyUploadResponse> {
    this.ensureStorageReady();

    // Security: reject keys that try to escape the prefix
    if (!key.startsWith(UPLOAD_PREFIX) || key.includes('..')) {
      throw new BadRequestException('Invalid upload key');
    }

    try {
      await this.storage!.getObject(key);
      return {
        key,
        exists: true,
        status: 'pending_scan',
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

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private ensureStorageReady(): void {
    if (!this.storage) {
      throw new ServiceUnavailableException(
        'Storage service is not configured. Set S3_BUCKET and S3_REGION environment variables.',
      );
    }
  }
}