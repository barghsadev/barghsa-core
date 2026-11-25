import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DashboardPage } from './DashboardPage.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { NavigationProvider } from '../hooks/useNavigation.js';
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
  expect(container.textContent).toContain('Legal agent');
  expect(container.querySelectorAll('[role="region"]')).toHaveLength(1);
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    '/api/dashboard/context',
    '/api/dashboard/widgets/status?profileId=legal-profile',
  ]);
});

it('deep-links to electricity immediately and labels a draft only for the confirmed profile', async () => {
  let confirm!: (value: Response) => void;
  const fetcher = vi.fn(async (url: string) => {
    if (url === '/api/dashboard/context')
      return new Promise<Response>((resolve) => {
        confirm = resolve;
      });
    if (url === '/api/electricity/drafts/simple/guarded?profileId=active-profile')
      return response({
        currentStep: 1,
        data: { period: 'next_week' },
        revision: 'e64f0f16-c1e0-4caa-bbd4-6d5b8e00772a',
      });
    return response({
      profileId: 'active-profile',
      data: { activeContracts: 0, pendingOrders: 0, openTickets: 0, unpaidInvoices: 0 },
    });
  });
  vi.stubGlobal('fetch', fetcher);
  await act(async () =>
    root.render(
      <QueryProvider>
        <AccountUserProvider value="customer">
          <NavigationProvider
            configuration={{
              version: 1,
              area: 'customer',
              profileId: 'active-profile',
              profileType: 'LEGAL',
              paths: ['/app', '/electricity'],
            }}
            revision={0}
          >
            <DashboardPage />
          </NavigationProvider>
        </AccountUserProvider>
      </QueryProvider>
    )
  );
  const primary = () => container.querySelector('a[href="/electricity/orders/new"]');
  expect(primary()?.textContent).toContain('Start an electricity order');
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/api/dashboard/context']);

  await act(async () =>
    confirm(
      response({
        profile: { id: 'active-profile', name: 'Current customer' },
        access: { wallet: false, invoices: false, orders: true, contracts: false },
      })
    )
  );
  await vi.waitFor(() => expect(primary()?.textContent).toContain('Continue electricity draft'));
  expect(fetcher.mock.calls.some(([url]) => url.endsWith('?profileId=active-profile'))).toBe(true);
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
        profile: { id: 'current', name: 'Unconfirmed profile' },
        access: { wallet: 'false', invoices: false, orders: false, contracts: false },
      })
    )
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
  expect(container.textContent).not.toContain('Unconfirmed profile');
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    '/api/dashboard/context',
    '/api/dashboard/context',
  ]);
  const retryMalformed = container.querySelector('[role="alert"] button') as HTMLButtonElement;
  await act(async () => retryMalformed.click());
  expect(container.textContent).toContain('Customer');
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it('contains malformed widget records in their own retry states', async () => {
  const replies = {
    wallet: {
      balance: 9007199254740992,
      currency: 'IRR',
      lowBalanceWarning: false,
      pendingInvoices: 0,
    },
    status: { activeContracts: 0, pendingOrders: -1, openTickets: 0, unpaidInvoices: 0 },
    invoices: [
      { invoiceId: 'invoice', dueAt: null, payableFrom: 'invalid', remainingAmount: '10' },
    ],
    orders: { orderId: 'misplaced-order' },
    contracts: [null],
  };
  const fetcher = vi.fn(async (url: string) =>
    url.endsWith('/context')
      ? response({
          profile: { id: 'current', name: 'Customer' },
          access: { wallet: true, invoices: true, orders: true, contracts: true },
        })
      : response({
          profileId: 'current',
          data: replies[url.split('/').at(-1)!.split('?')[0] as keyof typeof replies],
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
  await vi.waitFor(() => {
    expect(container.querySelectorAll('[role="region"] [role="alert"]')).toHaveLength(5);
  });
  expect(container.textContent).toContain('Customer');
  expect(container.querySelectorAll('[role="region"] [role="alert"] button')).toHaveLength(5);
  expect(fetcher).toHaveBeenCalledTimes(6);
});
