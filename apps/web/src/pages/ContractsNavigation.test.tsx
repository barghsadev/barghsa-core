import { QueryProvider } from '../test/query-provider.js';
import { NavigationProvider } from '../hooks/useNavigation.js';
import { getProfileContextRevision } from '../lib/profile-context.js';
import { Route as CustomerRoute } from '../routes/_app/contracts.js';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import AdminLayout from './AdminLayout.js';
import { DashboardLayout } from './DashboardLayout.js';
import { Route as ContractsRoute } from '../routes/admin/contracts.js';
import { createMemoryHistory, createRouter } from '@tanstack/react-router';
import { routeTree } from '../routeTree.gen.js';

vi.mock('@tanstack/react-router', async () => ({
  ...(await vi.importActual('@tanstack/react-router')),
  Outlet: () => null,
  useLocation: ({ select }: { select: (location: { pathname: string }) => unknown }) =>
    select({ pathname: '/contracts' }),
}));
vi.mock('../components/ContractsWorkspace.js', () => ({
  ContractsWorkspace: ({
    staff,
    queries,
  }: {
    staff?: boolean;
    queries?: import('../lib/record-list-query.js').RecordListQuery;
  }) => (
    <section aria-label={staff ? 'Staff contracts' : 'Customer contracts'}>
      <input
        aria-label="Restored criterion"
        value={queries?.queue.query.filters.contractNumber || ''}
        readOnly
      />
    </section>
  ),
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../components/AppShell.js', () => ({
  AppShell: ({ groups }: { groups: Array<{ items: Array<{ to: string; label: string }> }> }) => (
    <nav>
      {groups
        .flatMap((group) => group.items)
        .map((item) => (
          <a key={item.to} href={item.to}>
            {item.label}
          </a>
        ))}
    </nav>
  ),
}));

it('makes the implemented document workspaces reachable from both existing shells', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/contracts'] }),
    });
    expect(router.matchRoutes('/contracts').at(-1)?.routeId).toBe('/_app/contracts');
    expect(router.matchRoutes('/admin/contracts').at(-1)?.routeId).toBe('/admin/contracts');
    vi.spyOn(ContractsRoute, 'useSearch').mockReturnValue({
      contractNumber: '9223372036854775807',
    });
    vi.spyOn(ContractsRoute, 'useNavigate').mockReturnValue(vi.fn());
    const StaffView = ContractsRoute.options.component!;
    await act(async () => root.render(<QueryProvider>{<StaffView />}</QueryProvider>));
    expect(container.querySelector('[aria-label="Staff contracts"]')).not.toBeNull();
    expect(container.querySelector<HTMLInputElement>('input')?.value).toBe('9223372036854775807');
    const Pending = ContractsRoute.options.pendingComponent;
    await act(async () =>
      root.render(<QueryProvider>{Pending ? <Pending /> : null}</QueryProvider>)
    );
    expect(container.querySelector('[role=status]')).not.toBeNull();
    expect(CustomerRoute.options.component).toBeDefined();
    const CustomerPending = CustomerRoute.options.pendingComponent;
    await act(async () =>
      root.render(<QueryProvider>{CustomerPending ? <CustomerPending /> : null}</QueryProvider>)
    );
    expect(container.querySelector('[role=status]')).not.toBeNull();
    await act(async () =>
      root.render(
        <QueryProvider>
          {
            <NavigationProvider
              configuration={{
                version: 1,
                area: 'staff',
                profileId: null,
                profileType: null,
                paths: ['/admin/contracts', '/admin/documents'],
              }}
              revision={getProfileContextRevision()}
            >
              <AdminLayout />
            </NavigationProvider>
          }
        </QueryProvider>
      )
    );
    expect(container.querySelector('a[href="/admin/contracts"]')?.textContent).toBe(
      'Contract review'
    );
    await act(async () =>
      root.render(
        <QueryProvider>
          {
            <NavigationProvider
              configuration={{
                version: 1,
                area: 'customer',
                profileId: 'profile',
                profileType: 'INDIVIDUAL',
                paths: ['/contracts', '/documents'],
              }}
              revision={getProfileContextRevision()}
            >
              <DashboardLayout />
            </NavigationProvider>
          }
        </QueryProvider>
      )
    );
    expect(container.querySelector('a[href="/contracts"]')?.textContent).toBe('Contracts');
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  }
});
