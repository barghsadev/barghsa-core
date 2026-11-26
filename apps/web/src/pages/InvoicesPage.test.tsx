import { QueryProvider } from '../test/query-provider.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { InvoicesPage } from './InvoicesPage.js';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    search,
    className,
  }: {
    children: ReactNode;
    to: string;
    params?: { invoiceId: string };
    search?: { status?: string };
    className?: string;
  }) => (
    <a
      href={
        search?.status
          ? `${to}?status=${search.status}`
          : to.replace('$invoiceId', params?.invoiceId ?? '')
      }
      className={className}
    >
      {children}
    </a>
  ),
}));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ notice: null, format: (value: string | null) => value ?? '' }),
}));

it('loads unpaid invoices and offers the unfiltered list', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const request = vi.fn(async (path: string) =>
    Response.json(path === '/api/profiles' ? { activeProfileId: 'profile-1' } : { invoices: [] })
  );
  vi.stubGlobal('fetch', request);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <QueryProvider>
          <AccountUserProvider value="invoice-viewer">
            <InvoicesPage unpaidOnly />
          </AccountUserProvider>
        </QueryProvider>
      )
    );
    expect(request).toHaveBeenCalledWith('/api/invoices?status=unpaid', expect.any(Object));
    expect(container.textContent).toContain('No unpaid invoices');
    expect(container.querySelector('a[href="/invoices"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it('shows an invoice due date when the API supplies one', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) =>
      Response.json(
        path === '/api/profiles'
          ? { activeProfileId: 'profile-1' }
          : {
              invoices: [
                {
                  invoiceId: 'invoice-1',
                  role: 'original',
                  state: 'Unpaid',
                  totalAmount: '109000',
                  paidAmount: '40000',
                  issuedAt: '2026-09-23T10:00:00Z',
                  dueAt: '2026-09-30T10:00:00Z',
                  periodStart: '2026-10-01T00:00:00Z',
                  periodEnd: '2026-11-01T00:00:00Z',
                  explanation: null,
                },
              ],
            }
      )
    )
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <QueryProvider>
          <AccountUserProvider value="invoice-viewer">
            <InvoicesPage />
          </AccountUserProvider>
        </QueryProvider>
      )
    );
    const terms = new Map(
      [...container.querySelectorAll('dt')].map((term) => [
        term.textContent,
        term.nextElementSibling?.textContent,
      ])
    );
    expect(terms.get('Issued')).toBe('2026-09-23T10:00:00Z');
    expect(terms.get('Due')).toBe('2026-09-30T10:00:00Z');
    expect(terms.get('Confirmed paid')).toMatch(/^IRR\s+40,000$/);
    expect(container.textContent).toContain(
      'Electricity service period 2026-10-01T00:00:00Z – 2026-10-31T23:59:59.999Z'
    );
    expect(container.querySelector('a[href="/invoices/invoice-1"]')?.textContent).toBe('Original');
    expect(container.querySelector('li p bdi')?.textContent).toBe('invoice-1');
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
