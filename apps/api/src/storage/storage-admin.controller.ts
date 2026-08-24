import {
  Controller,
  Get,
  Put,
  Body,
  Post,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
} from '@nestjs/common';
import { STORAGE_PROVIDER } from './storage.constants.js';
import type { StorageProvider } from '@barghsa/shared/storage';
import { createStorageProvider } from '@barghsa/shared/storage';

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

/**
 * Storage configuration as exposed to the admin UI.
 *
 * The secret key value is write-only: it is accepted on PUT but NEVER
 * returned in GET.  The GET response sets `hasSecretKey: boolean` so the
 * UI can indicate whether a key is configured.
 */
export interface StorageConfigDto {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  hasSecretKey: boolean;
  forcePathStyle: boolean;
  privateEndpointUrl: string;
  publicEndpointUrl: string;
}

export interface UpdateStorageConfigDto {
  endpoint?: string;
  region?: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  privateEndpointUrl?: string;
  publicEndpointUrl?: string;
}

export interface TestConnectionResult {
  success: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Keys for env-backed storage (will be migrated to DB in a follow-up)
// ---------------------------------------------------------------------------

function readCurrentConfig(): StorageConfigDto {
  return {
    endpoint: process.env['S3_ENDPOINT'] ?? '',
    region: process.env['S3_REGION'] ?? '',
    bucket: process.env['S3_BUCKET'] ?? '',
    accessKeyId: process.env['S3_ACCESS_KEY_ID'] ?? '',
    hasSecretKey: !!process.env['S3_SECRET_ACCESS_KEY'],
    forcePathStyle: process.env['S3_FORCE_PATH_STYLE'] === 'true',
    privateEndpointUrl: process.env['S3_PRIVATE_ENDPOINT'] ?? '',
    publicEndpointUrl: process.env['S3_PUBLIC_ENDPOINT'] ?? '',
  };
}

function buildS3Config(dto: UpdateStorageConfigDto): Record<string, unknown> {
  return {
    type: 's3' as const,
    endpoint: dto.endpoint ?? process.env['S3_ENDPOINT'] ?? '',
    region: dto.region ?? process.env['S3_REGION'] ?? '',
    bucket: dto.bucket ?? process.env['S3_BUCKET'] ?? '',
    accessKeyId: dto.accessKeyId ?? process.env['S3_ACCESS_KEY_ID'] ?? '',
    secretAccessKey: dto.secretAccessKey ?? process.env['S3_SECRET_ACCESS_KEY'] ?? '',
    forcePathStyle: dto.forcePathStyle ?? process.env['S3_FORCE_PATH_STYLE'] === 'true',
  };
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@Controller('api/admin/storage')
export class StorageAdminController {
  private readonly logger = new Logger(StorageAdminController.name);

  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider | null,
  ) {}

  /**
   * GET /api/admin/storage/config
   *
   * Returns the current storage configuration.  The secret key value is
   * NEVER included; `hasSecretKey` indicates whether one is configured.
   */
  @Get('config')
  getConfig(): StorageConfigDto {
    return readCurrentConfig();
  }

  /**
   * PUT /api/admin/storage/config
   *
   * Updates storage configuration.  Only the fields included in the body
   * are changed; omitted fields keep their current value.
   *
   * Secret key is accepted on write but will not be returned by GET.
   */
  @Put('config')
  @HttpCode(HttpStatus.OK)
  updateConfig(@Body() dto: UpdateStorageConfigDto): StorageConfigDto {
    // Apply updates to environment variables (in-memory for the current process).
    // A permanent store (DB-backed config table) will be added in a follow-up.
    const fields: [string, string | undefined][] = [
      ['S3_ENDPOINT', dto.endpoint],
      ['S3_REGION', dto.region],
      ['S3_BUCKET', dto.bucket],
      ['S3_ACCESS_KEY_ID', dto.accessKeyId],
      ['S3_SECRET_ACCESS_KEY', dto.secretAccessKey],
      ['S3_FORCE_PATH_STYLE', dto.forcePathStyle !== undefined ? String(dto.forcePathStyle) : undefined],
      ['S3_PRIVATE_ENDPOINT', dto.privateEndpointUrl],
      ['S3_PUBLIC_ENDPOINT', dto.publicEndpointUrl],
    ];

    for (const [key, value] of fields) {
      if (value !== undefined) {
        process.env[key] = value;
      }
    }

    this.logger.log('Storage configuration updated (in-memory)');
    return readCurrentConfig();
  }

  /**
   * POST /api/admin/storage/test-connection
   *
   * Attempts a lightweight connection test using the provided (or current)
   * storage configuration.  Returns success/failure without persisting
   * anything.
   */
  @Post('test-connection')
  async testConnection(@Body() dto: UpdateStorageConfigDto): Promise<TestConnectionResult> {
    try {
      const config = buildS3Config(dto);
      const provider = createStorageProvider(
        config as unknown as Parameters<typeof createStorageProvider>[0],
        {
          warn: (msg, ...meta) => this.logger.warn(msg, ...meta),
          error: (msg, ...meta) => this.logger.error(msg, ...meta),
        },
      );

      // Simple probe: try to list objects with maxKeys=1.
      // If the bucket or credentials are invalid this will throw.
      await provider.listObjects('', 1);

      return { success: true, message: 'Connection successful' };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.warn(`Storage connection test failed: ${message}`);
      return { success: false, message };
    }
  }
}