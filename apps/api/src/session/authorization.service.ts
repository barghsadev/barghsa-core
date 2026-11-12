import {
  AGENT_ROLES,
  hasPermission,
  type AgentPermission,
  type AgentRole,
} from '@barghsa/shared/agent-permissions';
import type { AuthenticatedRequest } from './session.guard.js';

type StaffAuthority = Pick<
  AuthenticatedRequest['session'],
  'operatingContext' | 'isAdmin' | 'permissions'
>;

/** Resolves capabilities from current server authority. Resource reads and locks stay in the caller. */
export class AuthorizationService {
  allowsStaff(session: StaffAuthority | undefined, permission: string): boolean {
    if (session?.operatingContext !== 'staff' || !permission) return false;
    return (
      session.isAdmin === true ||
      (Array.isArray(session.permissions) &&
        (session.permissions.includes('*') || session.permissions.includes(permission)))
    );
  }

  allowsProfile(roles: readonly AgentRole[], permission: AgentPermission): boolean {
    return this.profileRoles(permission).some((role) => roles.includes(role));
  }

  profileRoles(permission: AgentPermission): AgentRole[] {
    return AGENT_ROLES.filter((role) => hasPermission(role, permission));
  }
}

export const authorizationService = new AuthorizationService();
