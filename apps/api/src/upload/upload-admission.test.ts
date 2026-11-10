import type { StorageProvider } from '@barghsa/shared/storage';
import { GLOBAL_MAX_UPLOAD_POLICY_SIZE_BYTES } from '@barghsa/shared/admin';
import { beforeEach, expect, it, vi } from 'vitest';
import { DocumentCreateSchema } from '../documents/document-validation.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import type { RateLimitService } from '../rate-limit/rate-limit.service.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { UploadPolicyResolver, type EffectiveUploadPolicy } from './upload-policy.resolver.js';
import { reserveUpload } from './upload-reservations.js';
import { UploadService } from './upload.service.js';
import { RecordUploadRequestSchema } from './upload.types.js';

vi.mock('./upload-reservations.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./upload-reservations.js')>()),
  reserveUpload: vi.fn(),
}));

const profileId = 'abcdef00-0000-4000-8000-000000000001';
const actor = {
  session: { userId: 'upload-user', operatingContext: 'customer' },
} as AuthenticatedRequest;
const document = {
  fileName: 'invoice.pdf',
  contentType: 'application/pdf',
  fileSize: 6 * 1024 * 1024,
  category: 'document',
};

function fixture(policyOverrides?: Partial<EffectiveUploadPolicy>) {
  const authorize = vi.fn().mockResolvedValue({ id: profileId });
  const enforce = vi.fn().mockResolvedValue(undefined);
  const put = vi.fn().mockResolvedValue('https://storage.example.test/upload');
  const storage = {
    presignedPutUrl: put,
    createMultipartUpload: vi.fn(),
    presignedUploadPartUrl: vi.fn(),
    listMultipartParts: vi.fn(),
    completeMultipartUpload: vi.fn(),
    abortMultipartUpload: vi.fn(),
  } as unknown as StorageProvider;
  const policy = new UploadPolicyResolver();
  vi.spyOn(policy, 'resolveEffective').mockResolvedValue({
    allowedExtensions: ['.pdf'],
    allowedMimeTypes: ['application/pdf'],
    maxSizeBytes: 10 * 1024 * 1024,
    source: 'deployment',
    policyId: null,
    ...policyOverrides,
  });
  const uploads = new UploadService(
    storage,
    null,
    policy,
    { getAccessibleProfile: authorize } as unknown as ProfilesService,
    { enforceSecurityRateLimit: enforce } as unknown as RateLimitService
  );
  const start = vi.spyOn(uploads, 'startMultipartForKey').mockResolvedValue({
    uploadId: 'upload',
    key: 'uploads/document/pending.pdf',
    partSize: 5 * 1024 * 1024,
    partCount: 2,
    expiresAt: undefined,
  });
  return { uploads, authorize, enforce, put, start };
}

beforeEach(() => vi.clearAllMocks());

it('uses one canonical profile quota for both direct and multipart reservations', async () => {
  const { uploads, authorize, enforce, put, start } = fixture();
  await uploads.getPresignedUrl({ ...document, profileId: profileId.toUpperCase() }, actor);
  await uploads.getMultipartUpload({ ...document, profileId }, actor);
  expect(enforce.mock.calls).toEqual([
    [`upload:profile:${profileId}`, 20, 60_000],
    [`upload:profile:${profileId}`, 20, 60_000],
  ]);
  expect(authorize.mock.invocationCallOrder[0]!).toBeLessThan(enforce.mock.invocationCallOrder[0]!);
  expect(enforce.mock.invocationCallOrder[0]!).toBeLessThan(
    vi.mocked(reserveUpload).mock.invocationCallOrder[0]!
  );
  expect(put).toHaveBeenCalledTimes(1);
  expect(start).toHaveBeenCalledTimes(1);
});

it('refuses a foreign profile or unknown metadata before touching the quota or storage', async () => {
  const { uploads, authorize, enforce, put } = fixture();
  await expect(
    uploads.getPresignedUrl({ ...document, profileId, metadata: { owner: 'other' } }, actor)
  ).rejects.toMatchObject({ status: 400 });
  authorize.mockResolvedValue(null);
  await expect(uploads.getPresignedUrl({ ...document, profileId }, actor)).rejects.toMatchObject({
    status: 404,
  });
  expect(enforce).not.toHaveBeenCalled();
  expect(reserveUpload).not.toHaveBeenCalled();
  expect(put).not.toHaveBeenCalled();
});

it('limits account-only uploads and prevents provider calls on exhaustion', async () => {
  const { uploads, enforce, put, start } = fixture();
  enforce.mockRejectedValueOnce(Object.assign(new Error('quota exhausted'), { status: 429 }));
  await expect(uploads.getMultipartUpload(document, actor)).rejects.toMatchObject({ status: 429 });
  expect(enforce).toHaveBeenCalledExactlyOnceWith('upload:user:upload-user', 20, 60_000);
  expect(reserveUpload).not.toHaveBeenCalled();
  expect(put).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
});

it('admits the full video policy through direct and multipart reservations', async () => {
  const fileSize = GLOBAL_MAX_UPLOAD_POLICY_SIZE_BYTES;
  const video = { fileName: 'proof.mp4', contentType: 'video/mp4', fileSize, category: 'video' };
  const { uploads, enforce, put, start } = fixture({
    allowedExtensions: ['.mp4'],
    allowedMimeTypes: ['video/mp4'],
    maxSizeBytes: fileSize,
  });
  await uploads.getPresignedUrl(video, actor);
  await uploads.getMultipartUpload(video, actor);
  await expect(
    uploads.getPresignedUrl({ ...video, fileSize: fileSize + 1 }, actor)
  ).rejects.toMatchObject({ status: 400 });
  expect(vi.mocked(reserveUpload).mock.calls.map(([options]) => options.fileSize)).toEqual([
    fileSize,
    fileSize,
  ]);
  expect(enforce).toHaveBeenCalledTimes(2);
  expect(put).toHaveBeenCalledOnce();
  expect(start).toHaveBeenCalledOnce();
  const business = {
    ...video,
    profileId,
    businessRecordType: 'standalone',
    idempotencyKey: profileId,
  };
  expect(DocumentCreateSchema.safeParse(business).success).toBe(true);
  expect(DocumentCreateSchema.safeParse({ ...business, fileSize: fileSize + 1 }).success).toBe(
    false
  );
  expect(RecordUploadRequestSchema.safeParse(video).success).toBe(true);
  expect(RecordUploadRequestSchema.safeParse({ ...video, fileSize: fileSize + 1 }).success).toBe(
    false
  );
});

it('still rejects a document above its narrower effective limit before reserving bytes', async () => {
  const { uploads, enforce, put } = fixture();
  await expect(
    uploads.getPresignedUrl({ ...document, fileSize: 10 * 1024 * 1024 + 1 }, actor)
  ).rejects.toMatchObject({ status: 400 });
  expect(enforce).not.toHaveBeenCalled();
  expect(reserveUpload).not.toHaveBeenCalled();
  expect(put).not.toHaveBeenCalled();
});
