import { expect, it, vi } from 'vitest';
import { UploadService } from './upload.service.js';
import { UploadPolicyResolver } from './upload-policy.resolver.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import type { RateLimitService } from '../rate-limit/rate-limit.service.js';

const rateLimits = {} as RateLimitService;

it('projects only effective formats and size without reserving storage or leaking policy actors', async () => {
  const resolver = new UploadPolicyResolver();
  vi.spyOn(resolver, 'resolveEffective').mockResolvedValue({
    allowedExtensions: ['.pdf', '.jpg', '.docx'],
    allowedMimeTypes: ['application/pdf', 'image/jpeg'],
    maxSizeBytes: 1048576,
    source: 'db',
    policyId: 'private-policy-id',
  });
  const uploads = new UploadService(null, null, resolver, {} as ProfilesService, rateLimits);
  expect(await uploads.filePolicy('document')).toEqual({
    category: 'document',
    maxSizeBytes: 1048576,
    formats: [
      { extension: '.pdf', mimeTypes: ['application/pdf'] },
      { extension: '.jpg', mimeTypes: ['image/jpeg'] },
    ],
  });
});
it('rejects an unknown category before consulting policy state', async () => {
  const resolver = new UploadPolicyResolver(),
    read = vi.spyOn(resolver, 'resolveEffective');
  const uploads = new UploadService(null, null, resolver, {} as ProfilesService, rateLimits);
  await expect(uploads.filePolicy('general')).rejects.toMatchObject({ status: 400 });
  expect(read).not.toHaveBeenCalled();
});
it('fails closed on unavailable policy state instead of publishing deployment fallbacks', async () => {
  const resolver = new UploadPolicyResolver();
  vi.spyOn(resolver, 'resolveEffective').mockRejectedValue(new Error('policy unavailable'));
  await expect(
    new UploadService(null, null, resolver, {} as ProfilesService, rateLimits).filePolicy('image')
  ).rejects.toThrow('policy unavailable');
});
