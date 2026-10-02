import { expect, it } from 'vitest';
import { isPendingInvitations } from './invitation-api.js';
const row = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  profileId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  profileName: 'Company',
  role: 'Finance',
  invitedBy: 'owner',
  inviterName: null,
  createdAt: '2026-01-01T00:00:00Z',
  expiresAt: null,
};
it('accepts only usable invitations and rejects malformed or duplicated rows', () => {
  expect(isPendingInvitations({ invitations: [row] })).toBe(true);
  for (const change of [
    { id: 'wrong' },
    { profileId: 'wrong' },
    { role: 'Owner' },
    { profileName: '' },
    { inviterName: 7 },
    { createdAt: 'invalid' },
    { createdAt: '2026-02-31T00:00:00Z' },
    { expiresAt: 'invalid' },
    { message: {} },
    { entity: { nationalIdentifier: 12, registrationNumber: null } },
  ])
    expect(isPendingInvitations({ invitations: [{ ...row, ...change }] })).toBe(false);
  expect(isPendingInvitations({ invitations: [row, row] })).toBe(false);
  expect(isPendingInvitations({ invitations: [] })).toBe(true);
});
