import type { NavigationGroup } from '../components/AppShell.js';
import { t } from '@barghsa/i18n/admin-ui';

/** Only implemented configuration routes. Operational queues keep the normal workspace. */
export const ADMIN_SETTINGS_SECTIONS = [
  { key: 'branding', paths: ['/admin/branding'] },
  { key: 'staff', paths: ['/admin/users', '/admin/roles', '/admin/staff-teams'] },
  { key: 'geography', paths: ['/admin/geography'] },
  { key: 'products', paths: ['/admin/catalogue'] },
  { key: 'pricing', paths: ['/admin/vat'] },
  { key: 'gifts', paths: ['/admin/gift-codes'] },
  { key: 'notifications', paths: ['/admin/notifications', '/admin/providers'] },
  {
    key: 'documents',
    paths: [
      '/admin/tos',
      '/admin/contract-templates',
      '/admin/document-templates',
      '/admin/upload-policies',
    ],
  },
  { key: 'electricity', paths: ['/admin/electricity-rules', '/admin/contract-limits'] },
  {
    key: 'ai',
    paths: [
      '/admin/ai-models',
      '/admin/knowledge-bases',
      '/admin/policies',
      '/admin/agents',
      '/admin/agent-slots',
    ],
  },
  { key: 'security', paths: ['/admin/verification'] },
  { key: 'system', paths: ['/admin/storage', '/admin/service-targets', '/admin/maintenance'] },
] as const;

export function activeAdminSettingsPath(pathname: string): string | null {
  return (
    ADMIN_SETTINGS_SECTIONS.flatMap((section) => [...section.paths]).find(
      (path) => pathname === path || pathname.startsWith(`${path}/`)
    ) ?? null
  );
}
/** Reuse the shell's route labels/icons and omit routes the caller does not offer. */
export function adminSettingsGroups(
  groups: readonly NavigationGroup[],
  locale: 'fa' | 'en'
): NavigationGroup[] {
  const items = new Map(groups.flatMap((group) => group.items).map((item) => [item.to, item]));
  return ADMIN_SETTINGS_SECTIONS.map((section) => ({
    label: t(`admin.settings.${section.key}`, locale),
    items: section.paths.flatMap((path) => (items.has(path) ? [items.get(path)!] : [])),
  })).filter((group) => group.items.length > 0);
}
