import { expect, it } from 'vitest';
import { hasStaffPermission, resolveStaffPermissions } from './staff-permissions.js';
import type { AuthenticatedRequest } from './session.guard.js';

it('unions valid roles and rejects invalid role data', () => {
  expect(
    resolveStaffPermissions([
      '["tickets:read","tickets:write"]',
      '["tickets:read"]',
      'invalid',
      '{"*":true}',
      '["*",1]',
    ])
  ).toEqual(['tickets:read', 'tickets:write']);
  expect(resolveStaffPermissions(null)).toEqual([]);
});

it('accepts exact capabilities or explicit wildcard authority without granting prefix matches', () => {
  const request = {
    session: { isAdmin: false, permissions: ['tickets:read'] },
  } as AuthenticatedRequest;
  expect(hasStaffPermission(request, 'tickets:read')).toBe(true);
  expect(hasStaffPermission(request, 'tickets:write')).toBe(false);
  request.session.permissions = ['tickets:*'];
  expect(hasStaffPermission(request, 'tickets:write')).toBe(false);
  request.session.permissions = ['*'];
  expect(hasStaffPermission(request, 'tickets:write')).toBe(true);
  request.session.permissions = [];
  request.session.isAdmin = true;
  expect(hasStaffPermission(request, 'tickets:write')).toBe(true);
});
