import type { NavigationGroup } from '../components/AppShell.js';

/** Select only routes supplied by the owning layout; never manufacture a grant or page. */
export function mobileNavigation(groups: NavigationGroup[], area: 'dashboard' | 'admin') {
  const all = [
    ...new Map(groups.flatMap((group) => group.items).map((item) => [item.to, item])).values(),
  ];
  const preferred =
    area === 'dashboard'
      ? ['/app', '/electricity', '/invoices', '/wallet']
      : ['/app', '/admin/inbox', '/admin/electricity-orders', '/admin/tickets'];
  const ranked = [...all].sort((a, b) => {
    const rank = (to: string) =>
      preferred.includes(to) ? preferred.indexOf(to) : preferred.length;
    return rank(a.to) - rank(b.to);
  });
  const primary = ranked.slice(0, 4);
  const selected = new Set(primary.map((item) => item.to));
  const remaining = groups
    .map((group) => ({ ...group, items: group.items.filter((item) => !selected.has(item.to)) }))
    .filter((group) => group.items.length > 0);
  return { primary, remaining };
}
