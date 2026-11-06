import { expect, it } from 'vitest';
import { vi } from 'vitest';
import type { ProfilesService } from '../profiles/profiles.service.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { requireUploadContext } from './upload-access.js';

const profiles = {} as ProfilesService;

function actor(operatingContext: 'staff' | 'customer') {
  return { session: { operatingContext, userId: 'dual-user' } } as AuthenticatedRequest;
}

it('keeps profile uploads in customer context and staff documents in staff context', async () => {
  await expect(
    requireUploadContext(profiles, actor('staff'), {
      purpose: 'ticket_attachment',
      profileId: '00000000-0000-4000-8000-000000000001',
    })
  ).rejects.toThrow('operating context');
  await expect(
    requireUploadContext(profiles, actor('customer'), { purpose: 'knowledge_base' })
  ).rejects.toThrow('operating context');
});
it.each(['crm:verify', 'crm:edit-identity'])(
  'allows %s staff to prepare profile-bound verification evidence',
  async (permission) => {
    const request = actor('staff');
    request.session.permissions = [permission];
    const read = vi.fn().mockResolvedValue({ id: 'profile' });
    await expect(
      requireUploadContext({ getProfileById: read } as unknown as ProfilesService, request, {
        purpose: 'verification_evidence',
        profileId: 'profile',
      })
    ).resolves.toBeUndefined();
    expect(read).toHaveBeenCalledWith('profile');
  }
);
it('refuses verification evidence without current verification authority or a profile', async () => {
  await expect(
    requireUploadContext(profiles, actor('staff'), {
      purpose: 'verification_evidence',
      profileId: 'profile',
    })
  ).rejects.toThrow('not permitted');
  const request = actor('staff');
  request.session.permissions = ['crm:verify'];
  await expect(
    requireUploadContext(profiles, request, { purpose: 'verification_evidence' })
  ).rejects.toThrow('requires a profile');
});
