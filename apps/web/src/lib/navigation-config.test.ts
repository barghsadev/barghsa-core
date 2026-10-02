import { expect, it } from 'vitest';
import { Zap } from 'lucide-react';
import { parseNavigation, permittedNavigation } from './navigation-config.js';

const config = {
  version: 1 as const,
  area: 'customer' as const,
  profileId: 'profile',
  profileType: 'LEGAL' as const,
  paths: ['/app', '/invoices', '/unknown'],
};
it('accepts known workspace versions and denies missing, malformed or different-workspace metadata', () => {
  expect(parseNavigation(config, 'customer')).toEqual(config);
  for (const value of [
    undefined,
    null,
    {},
    { ...config, version: 2 },
    { ...config, paths: ['/invoices', 1] },
    { ...config, paths: ['https://example.test'] },
    { ...config, paths: ['//example.test'] },
    { ...config, profileId: null },
    { ...config, profileType: 'Unknown' },
    { ...config, paths: Array(129).fill('/app') },
  ])
    expect(parseNavigation(value, 'customer')).toBeNull();
  expect(parseNavigation(config, 'staff')).toBeNull();
  expect(parseNavigation({ ...config, area: 'staff' }, 'staff')).toBeNull();
  expect(
    parseNavigation({ ...config, area: 'staff', profileId: null, profileType: null }, 'staff')
  ).not.toBeNull();
});
it('filters all groups through the exact supplied backend paths without adding unknown destinations', () => {
  const groups = [
    {
      label: 'Finance',
      items: ['/invoices', '/wallet'].map((to) => ({ to, label: to, icon: Zap })),
    },
    { label: 'Orders', items: [{ to: '/electricity', label: 'Electricity', icon: Zap }] },
  ];
  expect(permittedNavigation(groups, config, 'customer')).toEqual([
    { ...groups[0], items: [groups[0]!.items[0]] },
  ]);
  expect(
    permittedNavigation(groups, { ...config, paths: ['/invoices/some-id'] }, 'customer')
  ).toEqual([]);
  expect(permittedNavigation(groups, null, 'customer')).toEqual([]);
  expect(permittedNavigation(groups, config, 'staff')).toEqual([]);
});
