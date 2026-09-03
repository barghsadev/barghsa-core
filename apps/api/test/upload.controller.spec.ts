import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ServiceUnavailableException,
  InternalServerErrorException,
} from '@nestjs/common';
import type { StorageProvider } from '@barghsa/shared/storage';
import { StorageObjectNotFound } from '@barghsa/shared/storage';
import { STORAGE_PROVIDER, IMMUTABLE_STORAGE_SERVICE } from '../src/storage/index.js';
import { UploadController } from '../src/upload/upload.controller.js';
import { UploadPolicyResolver, type EffectiveUploadPolicy } from '../src/upload/upload-policy.resolver.js';
import { SessionAuthGuard } from '../src/session/session.guard.js';
import type { AuthenticatedRequest } from '../src/session/session.guard.js';
import {
  getDeploymentAllowedExtensions,
  getDeploymentAllowedMimeTypes,
  getDeploymentMaxSizeBytes,
} from '../src/upload/upload.config.js';

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

/** Effective policy mirroring the deployment baseline for a category. */
function deploymentPolicy(category: string): EffectiveUploadPolicy {
  const exts = getDeploymentAllowedExtensions(category);
  return {
    allowedExtensions: exts.length === 0 ? null : [...exts],
    allowedMimeTypes: [...getDeploymentAllowedMimeTypes(category)],
    maxSizeBytes: getDeploymentMaxSizeBytes(category),
    source: 'deployment',
    policyId: null,
  };
}

function streamOf(ascii: string): ReadableStream {
  const bytes = new TextEncoder().encode(ascii);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** Stream from raw bytes (magic signatures must be exact, not UTF-8 re-encoded). */
function streamOfBytes(parts: Array<number | string>): ReadableStream {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === 'number') out.push(part);
    else for (const ch of part) out.push(ch.charCodeAt(0));
  }
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(out));
      controller.close();
    },
  });
}

function pdfObject() {
  return {
    body: streamOf('%PDF-1.7\n1 0 obj'),
    contentType: 'application/pdf',
    contentLength: 18,
    metadata: {},
    etag: '"pdf1"',
  };
}

describe('UploadController', () => {
  let controller: UploadController;
  let storage: StorageProvider;
  let resolver: { resolveEffective: ReturnType<typeof vi.fn> };
  const mockImmutableService = { createRecord: vi.fn() };

  async function buildModule(overrides: { storage?: StorageProvider | null } = {}) {
    storage = overrides.storage === undefined ? mockStorageProvider() : overrides.storage;
    resolver = { resolveEffective: vi.fn(async (category: string) => deploymentPolicy(category)) };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UploadController],
      providers: [
        {
          provide: STORAGE_PROVIDER,
          useValue: storage,
        },
        {
          provide: IMMUTABLE_STORAGE_SERVICE,
          useValue: mockImmutableService,
        },
        {
          provide: UploadPolicyResolver,
          useValue: resolver,
        },
      ],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    return module.get(UploadController);
  }

  beforeEach(async () => {
    mockImmutableService.createRecord.mockReset();
    controller = await buildModule();
  });

  // -----------------------------------------------------------------------
  // getPresignedUrl — validation
  // -----------------------------------------------------------------------

  describe('getPresignedUrl', () => {
    it('returns 503 when storage is null', async () => {
      const ctrl = await buildModule({ storage: null });

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
          fileSize: 15 * 1024 * 1024, // 15MB > 10MB deployment cap for documents
          category: 'document',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('enforces a DB policy that narrows the deployment baseline', async () => {
      resolver.resolveEffective.mockResolvedValue({
        allowedExtensions: ['.pdf'],
        allowedMimeTypes: getDeploymentAllowedMimeTypes('document'),
        maxSizeBytes: 1024 * 1024,
        source: 'db',
        policyId: 'ppp',
      } satisfies EffectiveUploadPolicy);

      await expect(
        controller.getPresignedUrl({
          fileName: 'draft.docx',
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          fileSize: 1024,
          category: 'document',
        }),
      ).rejects.toThrow(BadRequestException); // .docx allowed by deployment, narrowed out by DB

      await expect(
        controller.getPresignedUrl({
          fileName: 'big.pdf',
          contentType: 'application/pdf',
          fileSize: 2 * 1024 * 1024, // above the 1 MB DB policy
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

    it('allows a valid video upload request (video deployment category)', async () => {
      vi.mocked(storage.presignedPutUrl).mockResolvedValue('https://s3.example.com/presigned');

      const result = await controller.getPresignedUrl({
        fileName: 'clip.mp4',
        contentType: 'video/mp4',
        fileSize: 50 * 1024 * 1024,
        category: 'video',
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
    it('fails closed when the key has no category segment', async () => {
      vi.mocked(storage.getObject).mockResolvedValue({
        body: new ReadableStream(),
        contentType: 'image/jpeg',
        contentLength: 1000,
        metadata: {},
        etag: '"abc123"',
      });

      // Legacy key shape `uploads/<uuid><ext>` — no category to resolve.
      await expect(
        controller.verifyUpload('uploads/some-uuid.jpg'),
      ).rejects.toThrow(BadRequestException);
      expect(storage.getObject).not.toHaveBeenCalled();
    });

    it('fails closed when the key carries an unknown category', async () => {
      await expect(
        controller.verifyUpload('uploads/bogus/some-uuid.pdf'),
      ).rejects.toThrow(BadRequestException);
      expect(storage.getObject).not.toHaveBeenCalled();
    });

    it('fails closed on unprefixed or traversal keys before touching storage', async () => {
      for (const bad of [
        'document/f.pdf', // missing uploads/ prefix
        'x/document/f.pdf', // wrong prefix
        'uploads/document/../../etc/passwd', // traversal
        'uploads/../document/f.pdf', // traversal via prefix
        'uploads/document/', // no file segment
        'uploads/document/a/b.pdf', // extra segment
      ]) {
        await expect(controller.verifyUpload(bad)).rejects.toThrow(BadRequestException);
      }
      expect(storage.getObject).not.toHaveBeenCalled();
    });

    it('round-trips every category resolveCategory can emit through presign → verify', async () => {
      vi.mocked(storage.presignedPutUrl).mockResolvedValue('https://s3.example.com/presigned');
      // category → (fileName, contentType, detected bytes) for a valid
      // upload per category. Covers resolveCategory's document/contract/
      // image/video/general branches, not just the admin-configurable set.
      const cases: Array<{
        recordType: string;
        fileName: string;
        contentType: string;
        object: ReturnType<typeof pdfObject>;
      }> = [
        {
          recordType: 'invoice',
          fileName: 'file.pdf',
          contentType: 'application/pdf',
          object: pdfObject(),
        },
        {
          recordType: 'contract',
          fileName: 'file.pdf',
          contentType: 'application/pdf',
          object: pdfObject(),
        },
        {
          recordType: 'avatar',
          fileName: 'file.png',
          contentType: 'image/png',
          object: {
            body: streamOfBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 'png']),
            contentType: 'image/png',
            contentLength: 12,
            metadata: {},
            etag: '"png"',
          },
        },
        {
          recordType: 'intro_video',
          fileName: 'file.mp4',
          contentType: 'video/mp4',
          object: {
            body: streamOfBytes([0x00, 0x00, 0x00, 0x18, 'ftypisom']),
            contentType: 'video/mp4',
            contentLength: 12,
            metadata: {},
            etag: '"mp4"',
          },
        },
        {
          recordType: 'mystery',
          fileName: 'file.pdf',
          contentType: 'application/pdf',
          object: pdfObject(),
        },
      ];
      for (const c of cases) {
        vi.mocked(storage.getObject).mockResolvedValue(c.object);
        const presigned = await controller.getPresignedUrl({
          fileName: c.fileName,
          contentType: c.contentType,
          fileSize: 1000,
          metadata: { recordType: c.recordType },
        });
        const result = await controller.verifyUpload(presigned.key);
        expect(result.status).toBe('confirmed');
      }
    });

    it('returns confirmed when detected bytes match the category policy', async () => {
      vi.mocked(storage.getObject).mockResolvedValue(pdfObject());

      const result = await controller.verifyUpload('uploads/document/some-uuid.pdf');

      expect(result).toEqual({
        key: 'uploads/document/some-uuid.pdf',
        exists: true,
        status: 'confirmed',
        detectedContentType: 'application/pdf',
      });
    });

    it('returns type_mismatch when detected bytes are not permitted for the category', async () => {
      vi.mocked(storage.getObject).mockResolvedValue({
        body: streamOfBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 'binary-image']),
        contentType: 'application/pdf', // spoofed at PUT time
        contentLength: 20,
        metadata: {},
        etag: '"png"',
      });

      const result = await controller.verifyUpload('uploads/document/some-uuid.pdf');

      expect(result).toMatchObject({
        key: 'uploads/document/some-uuid.pdf',
        exists: true,
        status: 'type_mismatch',
        detectedContentType: 'image/png',
      });
      expect(result.allowedMimeTypes).toContain('application/pdf');
      expect(result.allowedMimeTypes).not.toContain('image/png');
    });

    it('returns type_mismatch for an empty object (no sniffable signature, fail closed)', async () => {
      vi.mocked(storage.getObject).mockResolvedValue({
        body: streamOf(''),
        contentType: 'application/pdf',
        contentLength: 0,
        metadata: {},
        etag: '"empty"',
      });

      const result = await controller.verifyUpload('uploads/document/some-uuid.pdf');

      expect(result).toMatchObject({ exists: true, status: 'type_mismatch', detectedContentType: null });
    });

    it('returns not_found when object does not exist', async () => {
      vi.mocked(storage.getObject).mockRejectedValue(
        new StorageObjectNotFound('uploads/document/missing.jpg'),
      );

      const result = await controller.verifyUpload('uploads/document/missing.jpg');

      expect(result).toEqual({
        key: 'uploads/document/missing.jpg',
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
      const ctrl = await buildModule({ storage: null });

      await expect(
        ctrl.verifyUpload('uploads/test.pdf'),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  // -----------------------------------------------------------------------
  // recordUpload
  // -----------------------------------------------------------------------

  describe('recordUpload', () => {
    const req = { session: { userId: 'user-1' } } as AuthenticatedRequest;

    it('persists verified uploader identity and purpose after a confirmed sniff', async () => {
      vi.mocked(storage.getObject).mockResolvedValue(pdfObject());
      mockImmutableService.createRecord.mockResolvedValue(undefined);

      const result = await controller.recordUpload(
        'uploads/document/some-uuid.pdf',
        {
          fileName: 'receipt.pdf',
          purpose: 'bank_receipt',
          profileId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
        },
        req,
      );

      expect(result).toEqual({
        key: 'uploads/document/some-uuid.pdf',
        status: 'recorded',
      });
      expect(mockImmutableService.createRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          storageKey: 'uploads/document/some-uuid.pdf',
          fileSize: 18,
          metadata: expect.objectContaining({
            verified: true,
            uploadedBy: 'user-1',
            purpose: 'bank_receipt',
            profileId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
          }),
        }),
      );
    });

    it('persists trusted object size instead of a client-declared fileSize', async () => {
      vi.mocked(storage.getObject).mockResolvedValue(pdfObject());
      mockImmutableService.createRecord.mockResolvedValue(undefined);

      await controller.recordUpload(
        'uploads/document/some-uuid.pdf',
        { fileName: 'receipt.pdf', fileSize: 18, purpose: 'bank_receipt' },
        req,
      );

      expect(mockImmutableService.createRecord).toHaveBeenCalledWith(
        expect.objectContaining({ fileSize: 18 }),
      );
    });

    it('refuses to record a large object when the declared fileSize is forged small', async () => {
      vi.mocked(storage.getObject).mockResolvedValue({
        ...pdfObject(),
        contentLength: 10 * 1024 * 1024 + 1,
      });

      await expect(
        controller.recordUpload(
          'uploads/document/some-uuid.pdf',
          { fileName: 'receipt.pdf', fileSize: 4096, purpose: 'bank_receipt' },
          req,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockImmutableService.createRecord).not.toHaveBeenCalled();
    });

    it('refuses to record when the trusted object size exceeds the category limit', async () => {
      vi.mocked(storage.getObject).mockResolvedValue({
        ...pdfObject(),
        contentLength: 10 * 1024 * 1024 + 1,
      });

      await expect(
        controller.recordUpload(
          'uploads/document/some-uuid.pdf',
          { fileName: 'receipt.pdf', purpose: 'bank_receipt' },
          req,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockImmutableService.createRecord).not.toHaveBeenCalled();
    });

    it('refuses to record when trusted object size is unavailable', async () => {
      vi.mocked(storage.getObject).mockResolvedValue({
        ...pdfObject(),
        contentLength: undefined,
      });

      await expect(
        controller.recordUpload(
          'uploads/document/some-uuid.pdf',
          { fileName: 'receipt.pdf', fileSize: 18, purpose: 'bank_receipt' },
          req,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockImmutableService.createRecord).not.toHaveBeenCalled();
    });

    it('refuses to record when the object was never uploaded', async () => {
      vi.mocked(storage.getObject).mockRejectedValue(
        new StorageObjectNotFound('uploads/document/missing.pdf'),
      );

      await expect(
        controller.recordUpload('uploads/document/missing.pdf', { purpose: 'bank_receipt' }, req),
      ).rejects.toThrow(BadRequestException);
      expect(mockImmutableService.createRecord).not.toHaveBeenCalled();
    });

    it('refuses to record when detected bytes do not match the category', async () => {
      vi.mocked(storage.getObject).mockResolvedValue({
        body: streamOfBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 'binary-image']),
        contentType: 'application/pdf',
        contentLength: 20,
        metadata: {},
        etag: '"png"',
      });

      await expect(
        controller.recordUpload(
          'uploads/document/some-uuid.pdf',
          { purpose: 'bank_receipt' },
          req,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockImmutableService.createRecord).not.toHaveBeenCalled();
    });
  });
});
