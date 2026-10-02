import type { NavigationGroup } from '../components/AppShell.js';

export interface NavigationConfiguration {
  version: 1;
  area: 'staff' | 'customer';
  profileId: string | null;
  profileType: 'INDIVIDUAL' | 'LEGAL' | null;
  paths: string[];
}

export function parseNavigation(
  value: unknown,
  area: NavigationConfiguration['area']
): NavigationConfiguration | null {
  if (!value || typeof value !== 'object') return null;
  const config = value as Partial<NavigationConfiguration>;
  if (
    config.version !== 1 ||
    config.area !== area ||
    !Array.isArray(config.paths) ||
    config.paths.length > 128 ||
    !config.paths.every(
      (path) =>
        typeof path === 'string' && /^\/[a-zA-Z0-9/_-]*$/.test(path) && !path.startsWith('//')
    ) ||
    !(
      config.profileType === null ||
      config.profileType === 'INDIVIDUAL' ||
      config.profileType === 'LEGAL'
    ) ||
    !(
      config.profileId === null ||
      (typeof config.profileId === 'string' &&
        config.profileId.length > 0 &&
        config.profileId.length <= 128)
    ) ||
    (config.profileId === null) !== (config.profileType === null) ||
    (area === 'staff' && config.profileId !== null)
  )
    return null;
  return config as NavigationConfiguration;
}

/** Backend paths select existing local labels/icons; unknown destinations never become links. */
export function permittedNavigation(
  groups: NavigationGroup[],
  config: NavigationConfiguration | null,
  area: NavigationConfiguration['area']
): NavigationGroup[] {
  if (config?.area !== area) return [];
  const paths = new Set(config.paths);
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => paths.has(item.to)) }))
    .filter((group) => group.items.length > 0);
}
