import type { NavigationConfiguration } from '../src/lib/navigation-config.js';

/** Full read authority for existing shell fixtures; scoped access tests supply their own paths. */
export function fullNavigation(
  area: 'staff' | 'customer',
  profileType: 'INDIVIDUAL' | 'LEGAL' = 'INDIVIDUAL'
): NavigationConfiguration {
  const paths =
    area === 'staff'
      ? [
          '/app',
          '/admin/inbox',
          '/admin/tickets',
          '/admin/contracts',
          '/admin/electricity-orders',
          '/admin/saving-orders',
          '/admin/solar-requests',
          '/admin/consultations',
          '/admin/solar-postal',
          '/admin/solar-construction',
          '/admin/electricity-increases',
          '/admin/electricity-price-adjustments',
          '/admin/documents',
          '/admin/reconciliation',
          '/admin/service-targets',
          '/admin/staff-teams',
          '/admin/failed-notifications',
          '/admin/failed-jobs',
          '/admin/maintenance',
          '/admin/catalogue',
          '/admin/invoices',
          '/admin/wallet-receipts',
          '/admin/approval-requests',
          '/admin/gift-codes',
          '/admin/vat',
          '/admin/contract-templates',
          '/admin/document-templates',
          '/admin/contract-limits',
          '/admin/electricity-rules',
          '/admin/agents',
          '/admin/ai-models',
          '/admin/knowledge-bases',
          '/admin/policies',
          '/admin/agent-slots',
          '/admin/crm',
          '/admin/crm/corrections',
          '/admin/users',
          '/admin/roles',
          '/admin/branding',
          '/admin/geography',
          '/admin/tos',
          '/admin/verification',
          '/admin/notifications',
          '/admin/providers',
          '/admin/upload-policies',
          '/admin/storage',
        ]
      : [
          '/app',
          '/electricity',
          '/savings',
          '/solar/requests',
          '/consultations',
          '/wallet',
          '/invoices',
          '/contracts',
          '/documents',
          '/tickets',
          '/ai',
          '/notifications',
          '/settings/team',
          '/settings/profile',
          '/settings/addresses',
          '/settings',
        ];
  return {
    version: 1,
    area,
    profileId: area === 'staff' ? null : 'profile-1',
    profileType: area === 'staff' ? null : profileType,
    paths: paths.filter(
      (path) =>
        area === 'staff' ||
        ((path !== '/settings/team' || profileType === 'LEGAL') &&
          (path !== '/savings' || profileType === 'INDIVIDUAL'))
    ),
  };
}
