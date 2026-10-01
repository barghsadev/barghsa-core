export interface EffectivePermissions {
  userId: string;
  isAdmin: boolean;
  roleIds: string[];
  roleNames: string[];
  permissions: { permission: string; group: string }[];
  isWildcard: boolean;
}

/** Permission groups ordered for stable display. */
const GROUP_ORDER = [
  'admin',
  'users',
  'profiles',
  'tickets',
  'crm',
  'verification',
  'finance',
  'invoices',
  'payments',
  'reports',
  'legal',
  'contracts',
  'compliance',
  'operations',
  'orders',
  'scheduling',
  'config',
  'staff',
];

/** Group permissions by their prefix (module). */
export function groupPermissions(
  permissions: string[]
): { group: string; permissions: string[] }[] {
  const map = new Map<string, string[]>();
  for (const p of permissions) {
    const group = p.split(':')[0] ?? 'other';
    const list = map.get(group) ?? [];
    list.push(p);
    map.set(group, list);
  }
  const groups = [...map.entries()].map(([group, perms]) => ({
    group,
    permissions: perms.sort(),
  }));
  const sorted = groups.sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a.group);
    const ib = GROUP_ORDER.indexOf(b.group);
    if (ia === -1 && ib === -1) return a.group.localeCompare(b.group);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return sorted;
}

export function validEffective(value: unknown, userId: string): value is EffectivePermissions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const strings = (list: unknown): list is string[] =>
    Array.isArray(list) &&
    list.every((v) => typeof v === 'string' && v.trim() !== '') &&
    new Set(list).size === list.length;
  if (
    item.userId !== userId ||
    typeof item.isAdmin !== 'boolean' ||
    typeof item.isWildcard !== 'boolean' ||
    !strings(item.roleIds) ||
    !strings(item.roleNames) ||
    item.roleIds.length !== item.roleNames.length ||
    !Array.isArray(item.permissions)
  )
    return false;
  const permissions: string[] = [];
  for (const raw of item.permissions) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const row = raw as Record<string, unknown>;
    if (
      typeof row.permission !== 'string' ||
      !row.permission.trim() ||
      typeof row.group !== 'string' ||
      !row.group.trim()
    )
      return false;
    permissions.push(row.permission);
  }
  return (
    !(item.isAdmin && !item.isWildcard && permissions.length > 0) &&
    new Set(permissions).size === permissions.length &&
    (item.isWildcard
      ? permissions.length === 1 && permissions[0] === '*'
      : !permissions.includes('*'))
  );
}
