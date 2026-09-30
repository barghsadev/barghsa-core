import { expect, it } from 'vitest';
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
