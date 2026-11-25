import type { NavigationGroup } from '../components/AppShell.js';

export function currentNavigation(groups: NavigationGroup[], pathname: string) {
  const items = groups.flatMap((group) => group.items);
  return (
    items.find(({ activePath }) => activePath && activePath.test(pathname)) ??
    items
      .filter(
        (item) => pathname === item.to || (item.to !== '/app' && pathname.startsWith(item.to + '/'))
      )
      .sort((a, b) => b.to.length - a.to.length)[0]
  );
}
