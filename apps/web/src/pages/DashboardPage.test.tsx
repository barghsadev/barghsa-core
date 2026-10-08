import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DashboardPage } from './DashboardPage.js';
import { QueryProvider } from '../test/query-provider.js';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({
    status: 'ready',
    timezone: 'Asia/Tehran',
    notice: null,
    format: (date: unknown) => String(date),
  }),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ number: String, money: String, irrDigits: String }),
}));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

it('does not fetch or render widgets denied by current profile permissions', async () => {
  const fetcher = vi.fn(async (url: string) =>
    url.endsWith('/context')
      ? response({
          profile: { id: 'legal-profile', name: 'Legal agent' },
          access: { wallet: false, invoices: false, orders: false, contracts: false },
        })
      : response({
          profileId: 'legal-profile',
          data: { activeContracts: 0, pendingOrders: 0, openTickets: 0, unpaidInvoices: 0 },
        })
  );
  vi.stubGlobal('fetch', fetcher);
  await act(async () =>
    root.render(
      <QueryProvider>
        <DashboardPage />
      </QueryProvider>
    )
  );
  expect(container.textContent).toContain('Welcome, Legal agent');
  expect(container.querySelectorAll('[role="region"]')).toHaveLength(1);
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    '/api/dashboard/context',
    '/api/dashboard/widgets/status?profileId=legal-profile',
  ]);
});

it('shows a local retry instead of another profile’s response', async () => {
  const fetcher = vi.fn(async (url: string) =>
    url.endsWith('/context')
      ? response({
          profile: { id: 'current', name: 'Customer' },
          access: { wallet: false, invoices: false, orders: true, contracts: false },
        })
      : url.includes('/orders?')
        ? response({ profileId: 'other', data: [{ orderId: 'private-foreign-order' }] })
        : response({
            profileId: 'current',
            data: { activeContracts: 0, pendingOrders: 0, openTickets: 0, unpaidInvoices: 0 },
          })
  );
  vi.stubGlobal('fetch', fetcher);
  await act(async () =>
    root.render(
      <QueryProvider>
        <DashboardPage />
      </QueryProvider>
    )
  );
  expect(container.textContent).not.toContain('private-foreign-order');
  expect(container.querySelectorAll('[role="region"]')).toHaveLength(2);
  await vi.waitFor(() =>
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Retry this section')
  );
});

it('can retry a failed context without requesting protected widget data first', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response({}, 503))
    .mockResolvedValueOnce(
      response({
        profile: { id: 'current', name: 'Customer' },
        access: { wallet: false, invoices: false, orders: false, contracts: false },
      })
    )
    .mockResolvedValueOnce(
      response({
        profileId: 'current',
        data: { activeContracts: 0, pendingOrders: 0, openTickets: 0, unpaidInvoices: 0 },
      })
    );
  vi.stubGlobal('fetch', fetcher);
  await act(async () =>
    root.render(
      <QueryProvider>
        <DashboardPage />
      </QueryProvider>
    )
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  const retry = container.querySelector('[role="alert"] button') as HTMLButtonElement;
  await act(async () => retry.click());
  expect(container.textContent).toContain('Welcome, Customer');
  expect(fetcher).toHaveBeenCalledTimes(3);
});
