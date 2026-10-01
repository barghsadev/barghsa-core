import type { UploadPolicyDto } from '@barghsa/shared/admin';
export const policyLimit = {
  category: 'document',
  allowedExtensions: ['.pdf', '.docx'],
  maxSizeBytes: 10 * 1024 * 1024,
};
export const uploadPolicy: UploadPolicyDto = {
  id: '11111111-1111-4111-8111-111111111111',
  category: 'document',
  allowedExtensions: ['.pdf'],
  maxSizeBytes: 2 * 1024 * 1024,
  effectiveFrom: '2026-09-01T00:00:00Z',
  effectiveUntil: null,
  createdBy: 'admin',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  status: 'current',
};
export const catalogueRole = {
  roleId: 'finance',
  name: 'Finance reviewer',
  description: 'Payment review',
  permissions: ['finance:read', 'invoices:read'],
  predefined: true,
};
export const effectivePermissions = {
  userId: 'staff-one',
  isAdmin: false,
  isWildcard: false,
  roleIds: ['finance'],
  roleNames: ['Finance reviewer'],
  permissions: [{ permission: 'finance:read', group: 'finance' }],
};
