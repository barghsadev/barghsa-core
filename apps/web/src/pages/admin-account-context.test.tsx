import { QueryProvider } from '../test/query-provider.js';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminContextLayout } from './AdminLayout.js';
import { useListView } from '../hooks/useListView.js';
const context = vi.hoisted(() => ({ userId: 'finance' as string | null }));
vi.mock('@tanstack/react-router', () => ({
  useRouteContext: () => context,
  Outlet: () => <Probe />,
}));
vi.mock('../components/AppShell.js', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../components/AdminSettingsLayout.js', () => ({
  AdminSettingsLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../components/NotificationBell.js', () => ({ NotificationBell: () => null }));
vi.mock('../components/TosBanner.js', () => ({ TosBanner: () => null }));
function Probe() {
  const { view, setView } = useListView('staff-invoice-receipts-history');
  return (
    <>
      <output>{view}</output>
      <button onClick={() => setView('table')}>Table</button>
    </>
  );
}
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  context.userId = 'finance';
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
});
it('provides account-bound preferences to admin children and restores them after remount', async () => {
  await act(async () => root.render(<QueryProvider>{<AdminContextLayout />}</QueryProvider>));
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
  expect(localStorage.getItem('barghsa.list-view:finance:staff-invoice-receipts-history')).toBe(
    'table'
  );
  await act(async () => root.render(<QueryProvider>{null}</QueryProvider>));
  await act(async () => root.render(<QueryProvider>{<AdminContextLayout />}</QueryProvider>));
  expect(host.querySelector('output')!.textContent).toBe('table');
  context.userId = 'another-staff';
  await act(async () => root.render(<QueryProvider>{<AdminContextLayout />}</QueryProvider>));
  expect(host.querySelector('output')!.textContent).toBe('card');
  expect(
    localStorage.getItem('barghsa.list-view:another-staff:staff-invoice-receipts-history')
  ).toBeNull();
});
it('does not write a shared preference when the session lacks an account identity', async () => {
  context.userId = null;
  await act(async () => root.render(<QueryProvider>{<AdminContextLayout />}</QueryProvider>));
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
  expect(host.querySelector('output')!.textContent).toBe('table');
  expect(localStorage.length).toBe(0);
});
