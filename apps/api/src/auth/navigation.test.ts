import { expect, it } from 'vitest';
import { customerNavigation, resolveNavigation } from './navigation.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';

function staff(permissions: string[], isAdmin = false, staffAvailable = true) {
  return {
    session: { operatingContext: 'staff', permissions, isAdmin, staffAvailable },
  } as AuthenticatedRequest;
}
it('uses actual grants, including assigned-ticket scope, rather than treating every staff account as admin', async () => {
  expect((await resolveNavigation(staff([]))).paths).toEqual(['/app', '/admin/inbox']);
  expect((await resolveNavigation(staff(['tickets:assigned', 'invoices:read']))).paths).toEqual([
    '/app',
    '/admin/inbox',
    '/admin/tickets',
    '/admin/invoices',
  ]);
  expect(
    (await resolveNavigation(staff(['unknown', 'contracts:*', 'tickets:write']))).paths
  ).toEqual(['/app', '/admin/inbox']);
  expect((await resolveNavigation(staff(['*']))).paths).toEqual(
    (await resolveNavigation(staff([], true))).paths
  );
  expect((await resolveNavigation(staff(['*'], false, false))).paths).toEqual([]);
});
it('keeps destinations unique and distinguishes configuration read authority from unrelated writes', async () => {
  const all = (await resolveNavigation(staff([], true))).paths;
  expect(new Set(all).size).toBe(all.length);
  expect(all).toContain('/admin/storage');
  expect((await resolveNavigation(staff(['admin:roles:edit']))).paths).toEqual([
    '/app',
    '/admin/inbox',
    '/admin/roles',
  ]);
  expect(
    (await resolveNavigation(staff(['admin:branding:edit', 'admin:jobs:retry']))).paths
  ).toEqual(['/app', '/admin/inbox']);
});
it('separates individual and legal profile navigation and limits team links to agent-list authority', () => {
  const profile = { id: 'profile', profile_type: 'INDIVIDUAL' as const, is_owner: true, roles: [] };
  expect(customerNavigation(profile).paths).toContain('/savings');
  expect(customerNavigation(profile).paths).not.toContain('/settings/team');
  expect(customerNavigation({ ...profile, profile_type: 'LEGAL' }).paths).toContain(
    '/settings/team'
  );
  expect(customerNavigation({ ...profile, profile_type: 'LEGAL' }).paths).not.toContain('/savings');
  expect(
    customerNavigation({ ...profile, profile_type: 'LEGAL', is_owner: false, roles: ['Finance'] })
      .paths
  ).not.toContain('/settings/team');
});
it('projects additive profile roles without borrowing owner or staff powers', () => {
  const profile = {
    id: 'profile',
    profile_type: 'LEGAL' as const,
    is_owner: false,
    roles: ['Finance'] as const,
  };
  const finance = customerNavigation({ ...profile, roles: [...profile.roles] });
  expect(finance.paths).toEqual([
    '/app',
    '/notifications',
    '/settings',
    '/settings/profile',
    '/tickets',
    '/ai',
    '/wallet',
    '/invoices',
  ]);
  const combined = customerNavigation({ ...profile, roles: ['Finance', 'Legal'] });
  expect(combined.paths).toContain('/contracts');
  expect(combined.paths).not.toContain('/electricity');
  expect(combined.paths).not.toContain('/documents');
  expect(combined.paths).not.toContain('/settings/team');
  expect(customerNavigation().paths).toEqual(['/app', '/notifications', '/settings']);
});

it('allows service settings navigation for either independently granted configuration permission', async () => {
  for (const permission of ['admin:service-targets:edit', 'admin:service-escalation:edit'])
    expect((await resolveNavigation(staff([permission]))).paths).toEqual([
      '/app',
      '/admin/inbox',
      '/admin/service-targets',
    ]);
  expect(
    (
      await resolveNavigation(
        staff(['admin:service-escalation:edit', 'admin:service-targets:edit'])
      )
    ).paths.filter((path) => path === '/admin/service-targets')
  ).toHaveLength(1);
  expect((await resolveNavigation(staff(['admin:staff-teams:edit']))).paths).not.toContain(
    '/admin/service-targets'
  );
});
