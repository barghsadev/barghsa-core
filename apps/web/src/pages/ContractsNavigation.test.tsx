import { Route as CustomerRoute } from '../routes/_app/contracts.js';
import AdminContractsPage from './AdminContractsPage.js';
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
    expect(ContractsRoute.options.component).toBe(AdminContractsPage);
    const Pending = ContractsRoute.options.pendingComponent;
    await act(async () => root.render(Pending ? <Pending /> : null));
    expect(container.querySelector('[role=status]')).not.toBeNull();
    expect(CustomerRoute.options.component).toBeDefined();
    const CustomerPending = CustomerRoute.options.pendingComponent;
    await act(async () => root.render(CustomerPending ? <CustomerPending /> : null));
    expect(container.querySelector('[role=status]')).not.toBeNull();
    await act(async () => root.render(<AdminLayout />));
    expect(container.querySelector('a[href="/admin/contracts"]')?.textContent).toBe(
      'Contract review'
    );
    await act(async () => root.render(<DashboardLayout />));
    expect(container.querySelector('a[href="/contracts"]')?.textContent).toBe('Contracts');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
