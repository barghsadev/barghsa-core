import { getDbPool } from '@barghsa/db';
import {
  hasAnyRolePermission,
  type AgentPermission,
  type AgentRole,
} from '@barghsa/shared/agent-permissions';
import { ACTIVE_PROFILE_SQL } from '../profiles/profile-context.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';

export interface NavigationConfiguration {
  version: 1;
  area: 'staff' | 'customer';
  profileId: string | null;
  profileType: 'INDIVIDUAL' | 'LEGAL' | null;
  paths: string[];
}

/** Match the read authority of the destination API, rather than a frontend role name. */
export const STAFF_NAVIGATION: ReadonlyArray<readonly [string, ...string[]]> = [
  ['/admin/tickets', 'tickets:read', 'tickets:*', 'tickets:assigned'],
  ['/admin/contracts', 'contracts:read', 'contracts:write'],
  ['/admin/electricity-orders', 'contracts:read', 'contracts:write'],
  ['/admin/saving-orders', 'contracts:read', 'contracts:write'],
  ['/admin/solar-requests', 'orders:read'],
  ['/admin/consultations', 'orders:read'],
  ['/admin/solar-postal', 'orders:read'],
  ['/admin/solar-construction', 'orders:read'],
  ['/admin/electricity-increases', 'contracts:read', 'contracts:write'],
  ['/admin/electricity-price-adjustments', 'contracts:read', 'contracts:write'],
  ['/admin/documents', 'legal:read'],
  ['/admin/reconciliation', 'admin:reconciliation:view'],
  ['/admin/service-targets', 'admin:service-targets:edit', 'admin:service-escalation:edit'],
  ['/admin/staff-teams', 'admin:staff-teams:edit'],
  ['/admin/failed-notifications', 'admin:jobs:view'],
  ['/admin/failed-jobs', 'admin:jobs:view'],
  ['/admin/maintenance', 'admin:config:read', 'admin:config:write'],
  ['/admin/catalogue', 'admin:catalogue:edit'],
  ['/admin/invoices', 'invoices:read'],
  ['/admin/wallet-receipts', 'admin:finance:wallet:bank-receipt-confirm'],
  ['/admin/approval-requests', 'admin:financial:edit'],
  ['/admin/gift-codes', 'admin:promotions:edit'],
  ['/admin/vat', 'admin:finance:edit'],
  ['/admin/contract-templates', 'admin:documents:edit'],
  ['/admin/document-templates', 'admin:documents:edit'],
  ['/admin/contract-limits', 'admin:catalogue:edit'],
  ['/admin/electricity-rules', 'admin:catalogue:edit'],
  ['/admin/agents', 'admin:ai:agents'],
  ['/admin/ai-models', 'admin:ai:models'],
  ['/admin/knowledge-bases', 'admin:ai:kb'],
  ['/admin/policies', 'admin:ai:policies'],
  ['/admin/agent-slots', 'admin:ai:agents'],
  ['/admin/crm', 'crm:read'],
  ['/admin/crm/corrections', 'admin:jobs:view'],
  ['/admin/users', 'admin:staff:view'],
  ['/admin/roles', 'admin:roles:edit'],
  ['/admin/branding', 'admin:branding:read'],
  ['/admin/geography', 'admin:geography:edit'],
  ['/admin/tos', 'admin:tos:edit'],
  ['/admin/verification', 'admin:config:read'],
  ['/admin/notifications', 'admin:notifications:edit'],
  ['/admin/providers', 'admin:notification-providers:edit'],
  ['/admin/upload-policies', 'admin:uploads:edit'],
  ['/admin/storage', 'admin:storage:edit'],
];

export interface NavigationProfile {
  id: string;
  profile_type: 'INDIVIDUAL' | 'LEGAL';
  is_owner: boolean;
  roles: AgentRole[];
}

export function customerNavigation(profile?: NavigationProfile): NavigationConfiguration {
  const paths = ['/app', '/notifications', '/settings'];
  if (profile) {
    const allowed = (permission: AgentPermission) =>
      profile.is_owner || hasAnyRolePermission(profile.roles, permission);
    paths.push('/settings/profile', '/tickets', '/ai');
    if (allowed('orders:view')) {
      paths.push('/electricity', '/solar/requests');
      if (profile.profile_type === 'INDIVIDUAL') paths.push('/savings');
    }
    for (const [path, permission] of [
      ['/wallet', 'wallet:view'],
      ['/invoices', 'invoices:view'],
      ['/contracts', 'contracts:view'],
      ['/documents', 'documents:view'],
      ['/consultations', 'consultation:view'],
      ['/settings/addresses', 'addresses:view'],
    ] as const)
      if (allowed(permission)) paths.push(path);
    if (profile.profile_type === 'LEGAL' && allowed('agents:list')) paths.push('/settings/team');
  }
  return {
    version: 1,
    area: 'customer',
    profileId: profile?.id ?? null,
    profileType: profile?.profile_type ?? null,
    paths,
  };
}

export async function resolveNavigation(
  req: AuthenticatedRequest
): Promise<NavigationConfiguration> {
  if (req.session.operatingContext === 'staff') {
    return {
      version: 1,
      area: 'staff',
      profileId: null,
      profileType: null,
      paths: req.session.staffAvailable
        ? [
            '/app',
            '/admin/inbox',
            ...STAFF_NAVIGATION.filter(([, ...permissions]) =>
              permissions.some((permission) => hasStaffPermission(req, permission))
            ).map(([path]) => path),
          ]
        : [],
    };
  }
  const { rows } = await getDbPool().query<NavigationProfile>(
    `SELECT c.id,p.profile_type,c.is_owner,c.roles
     FROM (${ACTIVE_PROFILE_SQL}) c JOIN profiles p ON p.id=c.id`,
    [req.session.userId]
  );
  return customerNavigation(rows[0]);
}
