import { QueryProvider } from '../test/query-provider.js';
import { NavigationProvider } from '../hooks/useNavigation.js';
import { getProfileContextRevision } from '../lib/profile-context.js';
import { Route as CustomerRoute } from '../routes/_app/documents.js';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import AdminLayout from './AdminLayout.js';
import { DashboardLayout } from './DashboardLayout.js';
import { Route as DocumentsRoute } from '../routes/admin/documents.js';
import { createMemoryHistory, createRouter } from '@tanstack/react-router';
import { routeTree } from '../routeTree.gen.js';
import { refreshProfileContext, useProfileContextRevision } from '../lib/profile-context.js';

vi.mock('@tanstack/react-router', async () => ({
  ...(await vi.importActual('@tanstack/react-router')),
  Outlet: () => null,
  useLocation: ({ select }: { select: (location: { pathname: string }) => unknown }) =>
    select({ pathname: '/documents' }),
}));
vi.mock('../components/DocumentsWorkspace.js', () => ({
  DocumentsWorkspace: ({
    staff,
    queries,
  }: {
    staff?: boolean;
    queries?: import('../lib/record-list-query.js').RecordListQuery;
  }) => (
    <section aria-label={staff ? 'Staff documents' : 'Customer documents'}>
      <input aria-label="Restored criterion" value={queries?.queue.query.search || ''} readOnly />
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
      history: createMemoryHistory({ initialEntries: ['/documents'] }),
    });
    expect(router.matchRoutes('/documents').at(-1)?.routeId).toBe('/_app/documents');
    expect(router.matchRoutes('/admin/documents').at(-1)?.routeId).toBe('/admin/documents');
    vi.spyOn(DocumentsRoute, 'useSearch').mockReturnValue({ q: 'Review' });
    vi.spyOn(DocumentsRoute, 'useNavigate').mockReturnValue(vi.fn());
    const StaffView = DocumentsRoute.options.component!;
    await act(async () => root.render(<QueryProvider>{<StaffView />}</QueryProvider>));
    expect(container.querySelector('[aria-label="Staff documents"]')).not.toBeNull();
    expect(container.querySelector<HTMLInputElement>('input')?.value).toBe('Review');
    const Pending = DocumentsRoute.options.pendingComponent;
    await act(async () =>
      root.render(<QueryProvider>{Pending ? <Pending /> : null}</QueryProvider>)
    );
    expect(container.querySelector('[role=status]')).not.toBeNull();
    vi.spyOn(CustomerRoute, 'useSearch').mockReturnValue({ q: 'Customer review' });
    vi.spyOn(CustomerRoute, 'useNavigate').mockReturnValue(vi.fn());
    const CustomerView = CustomerRoute.options.component!;
    await act(async () => root.render(<QueryProvider>{<CustomerView />}</QueryProvider>));
    expect(container.querySelector('[aria-label="Customer documents"]')).not.toBeNull();
    expect(container.querySelector<HTMLInputElement>('input')?.value).toBe('Customer review');
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
    expect(container.querySelector('a[href="/admin/documents"]')?.textContent).toBe(
      'Document review'
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
    expect(container.querySelector('a[href="/documents"]')?.textContent).toBe('Documents');
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  }
});

it('clears document cursor and selection before a profile change remounts the route', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let search: Record<string, unknown> = {
    q: 'Review',
    category: 'document',
    cursor: '11111111-1111-4111-8111-111111111111',
    documentId: '22222222-2222-4222-8222-222222222222',
  };
  const navigate = vi
    .fn()
    .mockImplementation(
      (options: { search: (raw: Record<string, unknown>) => Record<string, unknown> }) => {
        search = options.search(search);
      }
    );
  vi.spyOn(CustomerRoute, 'useSearch').mockImplementation(() => search);
  vi.spyOn(CustomerRoute, 'useNavigate').mockReturnValue(navigate);
  const CustomerView = CustomerRoute.options.component!;
  function ScopedRoute() {
    const revision = useProfileContextRevision();
    return <CustomerView key={revision} />;
  }
  try {
    await act(async () => root.render(<QueryProvider>{<ScopedRoute />}</QueryProvider>));
    expect(navigate).not.toHaveBeenCalled();
    for (let change = 0; change < 2; change++) {
      search = {
        ...search,
        cursor: '11111111-1111-4111-8111-111111111111',
        documentId: '22222222-2222-4222-8222-222222222222',
      };
      await act(async () => refreshProfileContext());
      expect(search).toMatchObject({ q: 'Review', category: 'document' });
      expect(search.cursor).toBeUndefined();
      expect(search.documentId).toBeUndefined();
      expect(navigate).toHaveBeenCalledTimes(change + 1);
      expect(navigate.mock.calls.at(-1)?.[0]).toMatchObject({ replace: true, resetScroll: false });
      expect(container.querySelector<HTMLInputElement>('input')?.value).toBe('Review');
    }
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  }
  navigate.mockClear();
  refreshProfileContext();
  expect(navigate).not.toHaveBeenCalled();
});
