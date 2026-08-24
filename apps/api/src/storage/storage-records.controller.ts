import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Logger,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common'
import {
  ImmutableStorageRecordService,
  ImmutableRecordDeleteError,
  StorageObjectNotFound,
  type StorageRecordInfo,
} from '@barghsa/shared/storage'
import { STORAGE_PROVIDER } from './storage.module.js'

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface SignRecordDto {
  signedBy?: string
}

export interface StorageRecordResponse {
  key: string
  status: string
  fileName: string | null
  contentType: string | null
  fileSize: number | null
  category: string | null
  signedAt: string | null
  signedBy: string | null
  removedAt: string | null
}

function toResponse(info: StorageRecordInfo): StorageRecordResponse {
  return {
    key: info.key,
    status: info.status,
    fileName: info.fileName,
    contentType: info.contentType,
    fileSize: info.fileSize,
    category: info.category,
    signedAt: info.signedAt?.toISOString() ?? null,
    signedBy: info.signedBy,
    removedAt: info.removedAt?.toISOString() ?? null,
  }
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@Controller('api/admin/storage/records')
export class StorageRecordsController {
  private readonly logger = new Logger(StorageRecordsController.name)

  constructor(
    @Inject(STORAGE_PROVIDER)
    private readonly storageService: ImmutableStorageRecordService,
  ) {}

  /**
   * GET /api/admin/storage/records/:key
   *
   * Get the lifecycle status of a storage record.
   */
  @Get(':key')
  async getRecord(@Param('key') key: string): Promise<StorageRecordResponse> {
    const status = await this.storageService.getRecordStatus(key)
    if (!status) {
      throw new NotFoundException(`Storage record not found: "${key}"`)
    }
    return toResponse({
      key,
      status,
      fileName: null,
      contentType: null,
      fileSize: null,
      category: null,
      createdAt: null,
      updatedAt: null,
      signedAt: null,
      signedBy: null,
      removedAt: null,
    })
  }

  /**
   * POST /api/admin/storage/records/:key/sign
   *
   * Mark a storage record as immutable (signed/approved). After this
   * call, the object cannot be physically deleted — only soft-deleted.
   */
  @Post(':key/sign')
  @HttpCode(HttpStatus.OK)
  async signRecord(
    @Param('key') key: string,
    @Body() dto: SignRecordDto,
  ): Promise<StorageRecordResponse> {
    try {
      await this.storageService.markAsImmutable(key, dto.signedBy)
    } catch (err) {
      if (err instanceof StorageObjectNotFound) {
        throw new NotFoundException(err.message)
      }
      this.logger.error(`Failed to sign storage record "${key}":`, err)
      throw new InternalServerErrorException('Failed to sign storage record')
    }

    const status = await this.storageService.getRecordStatus(key)
    return toResponse({
      key,
      status: status ?? 'immutable',
      fileName: null,
      contentType: null,
      fileSize: null,
      category: null,
      createdAt: null,
      updatedAt: null,
      signedAt: new Date(),
      signedBy: dto.signedBy ?? null,
      removedAt: null,
    })
  }

  /**
   * DELETE /api/admin/storage/records/:key
   *
   * Delete (or soft-delete) a storage record.
   *
   * - Active records: physical delete on S3 + soft delete in PG.
   * - Immutable records: soft delete in PG only (S3 object retained).
   *   The response status is 409 Conflict with the soft-delete applied.
   * - Already-removed records: no-op (204).
   */
  @Delete(':key')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRecord(@Param('key') key: string): Promise<void> {
    try {
      await this.storageService.deleteRecord(key)
    } catch (err) {
      if (err instanceof ImmutableRecordDeleteError) {
        // Soft delete was performed despite the error — report conflict
        throw new ConflictException(err.message)
      }
      this.logger.error(`Failed to delete storage record "${key}":`, err)
      throw new InternalServerErrorException('Failed to delete storage record')
    }
  }
}