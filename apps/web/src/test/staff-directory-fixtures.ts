import { DEFAULT_STAFF_ASSIGNMENT_RULES } from '@barghsa/shared/admin';
export const staffTeamId = '11111111-1111-4111-8111-111111111111';
export const staffMemberId = '22222222-2222-4222-8222-222222222222';
export const staffAccess = {
  userId: 'admin',
  canView: true,
  canCreate: true,
  canEditRoles: true,
  canDisable: true,
};
export const staffRoles = [
  { roleId: 'role-finance', name: 'Finance', description: 'Manage finances' },
];
export const staffUser = {
  userId: staffMemberId,
  username: 'staff@example.test',
  firstName: 'Finance',
  lastName: 'Alice',
  roles: staffRoles,
  status: 'active',
  activationPending: false,
  activationExpiresAt: null,
  lastLoginAt: null,
  isAdmin: false,
};
export const staffTeam = {
  id: staffTeamId,
  name: 'Finance team',
  description: 'Payment review',
  skillTags: ['finance'],
  isActive: true,
  memberUserIds: [staffMemberId],
  leadUserId: staffMemberId,
};
export const staffMember = { id: staffMemberId, name: 'Finance Alice', eligible: true };
export const staffRoutingRules = structuredClone(DEFAULT_STAFF_ASSIGNMENT_RULES);
