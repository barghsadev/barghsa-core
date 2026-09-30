import type { AuthenticatedRequest } from './session.guard.js';

/** Permission data comes from current database roles on every authenticated request. */
export function hasStaffPermission(request: AuthenticatedRequest, permission: string): boolean {
  const session = request.session;
  return Boolean(
    session &&
    session.operatingContext !== 'customer' &&
    (session.isAdmin === true ||
      session.permissions?.includes('*') ||
      session.permissions?.includes(permission))
  );
}

export { resolveStaffPermissions } from '@barghsa/shared/admin';
