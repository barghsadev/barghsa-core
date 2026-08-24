import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ServiceUnavailableException,
  InternalServerErrorException,
} from '@nestjs/common';
import type { StorageProvider } from '@barghsa/shared/storage';
import { StorageObjectNotFound } from '@barghsa/shared/storage';
import { STORAGE_PROVIDER } from '../src/storage/index.js';
import { UploadController } from '../src/upload/upload.controller.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockStorageProvider(): StorageProvider {
  return {
    putObject: vi.fn(),
    getObject: vi.fn(),
    deleteObject: vi.fn(),
    presignedPutUrl: vi.fn(),
    presignedGetUrl: vi.fn(),
    listObjects: vi.fn(),
  };
}

describe('UploadController', () => {
  let controller: UploadController;
  let storage: StorageProvider;

  beforeEach(async () => {
    storage = mockStorageProvider();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UploadController],
      providers: [
        {
          provide: STORAGE_PROVIDER,
          useValue: storage,
        },
      ],
    }).compile();

    controller = module.get(UploadController);
  });

  // -----------------------------------------------------------------------
  // getPresignedUrl — validation
  // -----------------------------------------------------------------------

  describe('getPresignedUrl', () => {
    it('returns 503 when storage is null', async () => {
      const module: TestingModule = await Test.createTestingModule({
        controllers: [UploadController],
        providers: [{ provide: STORAGE_PROVIDER, useValue: null }],
      }).compile();
      const ctrl = module.get(UploadController);

      await expect(
        ctrl.getPresignedUrl({}),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('rejects requests with missing fileName', async () => {
      await expect(
        controller.getPresignedUrl({ contentType: 'image/jpeg', fileSize: 1000 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects requests with missing contentType', async () => {
      await expect(
        controller.getPresignedUrl({ fileName: 'test.jpg', fileSize: 1000 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects requests with missing fileSize', async () => {
      await expect(
        controller.getPresignedUrl({ fileName: 'test.jpg', contentType: 'image/jpeg' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects requests with negative fileSize', async () => {
      await expect(
        controller.getPresignedUrl({
          fileName: 'test.jpg',
          contentType: 'image/jpeg',
          fileSize: -1,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects disallowed file extension for image category', async () => {
      await expect(
        controller.getPresignedUrl({
          fileName: 'malware.exe',
          contentType: 'application/x-msdownload',
          fileSize: 1000,
          category: 'image',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects disallowed MIME type for document category', async () => {
      await expect(
        controller.getPresignedUrl({
          fileName: 'report.pdf',
          contentType: 'video/mp4',
          fileSize: 1000,
          category: 'document',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects oversized files for document category', async () => {
      await expect(
        controller.getPresignedUrl({
          fileName: 'huge.pdf',
          contentType: 'application/pdf',
          fileSize: 15 * 1024 * 1024, // 15MB > 10MB limit for documents
          category: 'document',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows a valid image upload request', async () => {
      vi.mocked(storage.presignedPutUrl).mockResolvedValue('https://s3.example.com/presigned');

      const result = await controller.getPresignedUrl({
        fileName: 'photo.jpg',
        contentType: 'image/jpeg',
        fileSize: 1024 * 1024,
        category: 'image',
        metadata: { recordType: 'avatar' },
      });

      expect(result).toMatchObject({
        key: expect.stringContaining('uploads/'),
        presignedUrl: 'https://s3.example.com/presigned',
        expiresIn: 3600,
      });
      expect(storage.presignedPutUrl).toHaveBeenCalledWith(
        expect.stringContaining('uploads/'),
        3600,
      );
    });

    it('allows a valid document upload request with general category', async () => {
      vi.mocked(storage.presignedPutUrl).mockResolvedValue('https://s3.example.com/presigned');

      const result = await controller.getPresignedUrl({
        fileName: 'data.zip',
        contentType: 'application/zip',
        fileSize: 5 * 1024 * 1024,
      });

      expect(result).toMatchObject({
        key: expect.stringContaining('uploads/'),
        presignedUrl: 'https://s3.example.com/presigned',
        expiresIn: 3600,
      });
    });

    it('throws InternalServerError on S3 provider failure', async () => {
      vi.mocked(storage.presignedPutUrl).mockRejectedValue(
        new Error('S3 timeout'),
      );

      await expect(
        controller.getPresignedUrl({
          fileName: 'test.pdf',
          contentType: 'application/pdf',
          fileSize: 1000,
          category: 'document',
        }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // -----------------------------------------------------------------------
  // verifyUpload
  // -----------------------------------------------------------------------

  describe('verifyUpload', () => {
    it('returns pending_scan when object exists', async () => {
      vi.mocked(storage.getObject).mockResolvedValue({
        body: new ReadableStream(),
        contentType: 'image/jpeg',
        contentLength: 1000,
        metadata: {},
        etag: '"abc123"',
      });

      const result = await controller.verifyUpload('uploads/some-uuid.jpg');

      expect(result).toEqual({
        key: 'uploads/some-uuid.jpg',
        exists: true,
        status: 'pending_scan',
      });
    });

    it('returns not_found when object does not exist', async () => {
      vi.mocked(storage.getObject).mockRejectedValue(
        new StorageObjectNotFound('uploads/missing.jpg'),
      );

      const result = await controller.verifyUpload('uploads/missing.jpg');

      expect(result).toEqual({
        key: 'uploads/missing.jpg',
        exists: false,
        status: 'not_found',
      });
    });

    it('rejects keys that do not start with uploads/', async () => {
      await expect(
        controller.verifyUpload('etc/passwd'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects keys with directory traversal', async () => {
      await expect(
        controller.verifyUpload('uploads/../../etc/passwd'),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns 503 when storage is null', async () => {
      const module: TestingModule = await Test.createTestingModule({
        controllers: [UploadController],
        providers: [{ provide: STORAGE_PROVIDER, useValue: null }],
      }).compile();
      const ctrl = module.get(UploadController);

      await expect(
        ctrl.verifyUpload('uploads/test.pdf'),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });
});