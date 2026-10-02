import { expect, it } from 'vitest';
import { Zap } from 'lucide-react';
import { currentNavigation } from './shell-navigation.js';
import { mobileNavigation } from './mobile-navigation.js';
import type { NavigationGroup } from '../components/AppShell.js';

const group = (...routes: string[]): NavigationGroup[] => [
  { label: 'Pages', items: routes.map((to) => ({ to, label: to, icon: Zap })) },
];
it('selects service tabs and keeps every supplied page reachable exactly once', () => {
  const groups = group(
    '/app',
    '/solar/requests',
    '/electricity',
    '/invoices',
    '/wallet',
    '/contracts',
    '/tickets'
  );
  const { primary, remaining } = mobileNavigation(groups, 'dashboard');
  expect(primary.map((item) => item.to)).toEqual(['/app', '/electricity', '/invoices', '/wallet']);
  expect(
    [...primary, ...remaining.flatMap((entry) => entry.items)].map((item) => item.to).sort()
  ).toEqual(groups[0]!.items.map((item) => item.to).sort());
});
it('uses staff operations when they are supplied, and never adds a missing route', () => {
  const groups = group(
    '/admin/contracts',
    '/app',
    '/admin/tickets',
    '/admin/inbox',
    '/admin/electricity-orders'
  );
  expect(mobileNavigation(groups, 'admin').primary.map((item) => item.to)).toEqual([
    '/app',
    '/admin/inbox',
    '/admin/electricity-orders',
    '/admin/tickets',
  ]);
  expect(
    mobileNavigation(group('/app', '/admin/contracts'), 'admin').primary.map((item) => item.to)
  ).toEqual(['/app', '/admin/contracts']);
  expect(mobileNavigation([], 'dashboard')).toEqual({ primary: [], remaining: [] });
});
it('deduplicates primary routes shared across navigation groups', () => {
  expect(
    mobileNavigation(
      [...group('/app', '/wallet'), ...group('/wallet', '/invoices')],
      'dashboard'
    ).primary.map((item) => item.to)
  ).toEqual(['/app', '/invoices', '/wallet']);
});
it('matches the longest actual page prefix and respects route boundaries', () => {
  const groups = group('/app', '/electricity', '/electricity/orders', '/invoices');
  expect(currentNavigation(groups, '/electricity/orders/private-id')?.to).toBe(
    '/electricity/orders'
  );
  expect(currentNavigation(groups, '/invoices/private-id')?.to).toBe('/invoices');
  expect(currentNavigation(groups, '/invoices-other')).toBeUndefined();
  expect(currentNavigation(groups, '/app-other')).toBeUndefined();
  expect(currentNavigation(groups, '/app')?.to).toBe('/app');
});
