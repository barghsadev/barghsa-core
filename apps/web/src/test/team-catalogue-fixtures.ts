import type { Team, TeamEntry, OwnershipTransfer } from '../lib/team-catalogue.js';
export const legalProfileId = '00000000-0000-4000-8000-000000000001';
export const teamMember = (): TeamEntry => ({
  id: 'member-one',
  type: 'agent',
  userId: 'member',
  username: 'member@example.test',
  name: null,
  role: 'Manager',
  status: 'Active',
  joinedAt: '2026-08-01T01:00:00Z',
  createdAt: '2026-08-01T01:00:00Z',
});
export const teamInvitation = (): TeamEntry => ({
  id: 'invitation-one',
  type: 'invitation',
  userId: null,
  username: 'invited@example.test',
  name: null,
  role: 'Finance',
  status: 'Pending',
  joinedAt: null,
  createdAt: '2026-09-01T01:00:00Z',
});
export const teamCatalogue = (): Team => ({
  profileId: legalProfileId,
  profileName: 'Example company',
  canTransferOwnership: true,
  agents: [teamMember(), teamInvitation()],
});
export const teamProfiles = () => ({
  profiles: [{ id: legalProfileId, profileType: 'LEGAL', title: 'Example company' }],
  activeProfileId: legalProfileId,
  hasDefault: true,
});
export const ownershipTransfer = (): OwnershipTransfer => ({
  id: 'transfer-one',
  profileId: legalProfileId,
  profileName: 'Transfer company',
  direction: 'incoming',
  expiresAt: '2099-09-01T00:00:00Z',
});
