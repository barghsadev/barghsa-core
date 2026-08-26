/**
 * Agent role permissions for Barghsa legal profiles.
 *
 * Defines the permission matrix used by the AgentRoleGuard to enforce
 * role-based access control on profile-scoped API endpoints.
 *
 * Permissions are additive: an agent with multiple roles inherits the
 * union of all granted permissions.
 *
 * @see 02-auth-users-admin.md#T-05.04.04
 */

// ─── Roles ────────────────────────────────────────────────────────────

export const AGENT_ROLES = ['Owner', 'Manager', 'Finance', 'Legal'] as const
export type AgentRole = (typeof AGENT_ROLES)[number]

// ─── Permissions ──────────────────────────────────────────────────────

export const AGENT_PERMISSIONS = [
  // ── Profile / Identity ──────────────────────────────────────
  'profile:view',
  'profile:edit',
  'profile:transfer-ownership',
  'profile:edit-protected-fields',

  // ── Agents ───────────────────────────────────────────────────
  'agents:list',
  'agents:invite',
  'agents:remove',
  'agents:change-role',

  // ── Orders ───────────────────────────────────────────────────
  'orders:view',
  'orders:create',
  'orders:cancel',

  // ── Contracts / Legal ────────────────────────────────────────
  'contracts:view',
  'contracts:sign',
  'contracts:reject',
  'contracts:request-changes',

  // ── Invoices / Finance ───────────────────────────────────────
  'invoices:view',
  'payments:view',
  'wallet:view',
  'wallet:charge',
  'wallet:move-funds',
  'bank-receipts:submit',
  'refunds:view',

  // ── Consultation / Documents ─────────────────────────────────
  'consultation:view',
  'documents:view',
  'cancellation:request',

  // ── Addresses ────────────────────────────────────────────────
  'addresses:view',
  'addresses:edit',
] as const

export type AgentPermission = (typeof AGENT_PERMISSIONS)[number]

// ─── Permission Matrix ────────────────────────────────────────────────
//
// Owner:   full customer-side control
// Manager: operational access (addresses, orders, consultation, documents,
//          comments, inviting/removing non-owner agents)
// Finance: invoices, wallet, payments, receipts, refunds; charge wallet,
//          submit bank receipts. Cannot accept/sign contracts.
// Legal:   contracts and legal documents only. Cannot move wallet funds.

const PERMISSION_MATRIX: Record<AgentRole, ReadonlySet<AgentPermission>> = {
  Owner: new Set(AGENT_PERMISSIONS),

  Manager: new Set<AgentPermission>([
    'profile:view',
    'agents:list',
    'agents:invite',
    'agents:remove',
    'agents:change-role',
    'orders:view',
    'orders:create',
    'orders:cancel',
    'contracts:view',
    'invoices:view',
    'payments:view',
    'wallet:view',
    'consultation:view',
    'documents:view',
    'cancellation:request',
    'addresses:view',
    'addresses:edit',
  ]),

  Finance: new Set<AgentPermission>([
    'profile:view',
    'invoices:view',
    'payments:view',
    'wallet:view',
    'wallet:charge',
    'bank-receipts:submit',
    'refunds:view',
  ]),

  Legal: new Set<AgentPermission>([
    'profile:view',
    'contracts:view',
    'contracts:sign',
    'contracts:reject',
    'contracts:request-changes',
  ]),
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Check whether a given role has a specific permission.
 */
export function hasPermission(
  role: AgentRole,
  permission: AgentPermission,
): boolean {
  return PERMISSION_MATRIX[role].has(permission)
}

/**
 * Return the set of permissions granted to a specific role.
 */
export function getRolePermissions(role: AgentRole): readonly AgentPermission[] {
  return [...PERMISSION_MATRIX[role]]
}

/**
 * Return the union of permissions granted to a list of roles (additive).
 * Used when an agent has multiple roles.
 */
export function getCombinedPermissions(
  roles: AgentRole[],
): Set<AgentPermission> {
  const combined = new Set<AgentPermission>()
  for (const role of roles) {
    for (const perm of PERMISSION_MATRIX[role]) {
      combined.add(perm)
    }
  }
  return combined
}

/**
 * Check whether any of the given roles has a specific permission.
 */
export function hasAnyRolePermission(
  roles: AgentRole[],
  permission: AgentPermission,
): boolean {
  return roles.some((role) => PERMISSION_MATRIX[role].has(permission))
}