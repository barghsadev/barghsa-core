import { Route as CustomerRoute } from '../routes/_app/documents.js';
import DocumentsPage from './DocumentsPage.js';
import AdminDocumentsPage from './AdminDocumentsPage.js';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import AdminLayout from './AdminLayout.js';
import { DashboardLayout } from './DashboardLayout.js';
import { Route as DocumentsRoute } from '../routes/admin/documents.js';
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
      history: createMemoryHistory({ initialEntries: ['/documents'] }),
    });
    expect(router.matchRoutes('/documents').at(-1)?.routeId).toBe('/_app/documents');
    expect(router.matchRoutes('/admin/documents').at(-1)?.routeId).toBe('/admin/documents');
    expect(DocumentsRoute.options.component).toBe(AdminDocumentsPage);
    const Pending = DocumentsRoute.options.pendingComponent;
    await act(async () => root.render(Pending ? <Pending /> : null));
    expect(container.querySelector('[role=status]')).not.toBeNull();
    expect(CustomerRoute.options.component).toBe(DocumentsPage);
    const CustomerPending = CustomerRoute.options.pendingComponent;
    await act(async () => root.render(CustomerPending ? <CustomerPending /> : null));
    expect(container.querySelector('[role=status]')).not.toBeNull();
    await act(async () => root.render(<AdminLayout />));
    expect(container.querySelector('a[href="/admin/documents"]')?.textContent).toBe(
      'Document review'
    );
    await act(async () => root.render(<DashboardLayout />));
    expect(container.querySelector('a[href="/documents"]')?.textContent).toBe('Documents');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
