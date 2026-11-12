import type { AuthenticatedRequest } from './session.guard.js';
import { authorizationService } from './authorization.service.js';

/** Permission data comes from current database roles on every authenticated request. */
export function hasStaffPermission(request: AuthenticatedRequest, permission: string): boolean {
  return authorizationService.allowsStaff(request.session, permission);
}

export { resolveStaffPermissions } from '@barghsa/shared/admin';
