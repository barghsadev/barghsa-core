import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { InvoicesPage } from './InvoicesPage.js';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search,
    className,
  }: {
    children: ReactNode;
    to: string;
    search?: { status?: string };
    className?: string;
  }) => (
    <a href={search?.status ? `${to}?status=${search.status}` : to} className={className}>
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
  const request = vi.fn(async () => Response.json({ invoices: [] }));
  vi.stubGlobal('fetch', request);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<InvoicesPage unpaidOnly />));
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
    vi.fn(async () =>
      Response.json({
        invoices: [
          {
            invoiceId: 'invoice-1',
            role: 'original',
            state: 'Unpaid',
            totalAmount: '109000',
            issuedAt: '2026-09-23T10:00:00Z',
            dueAt: '2026-09-30T10:00:00Z',
            explanation: null,
          },
        ],
      })
    )
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<InvoicesPage />));
    expect(container.textContent).toContain('Issued: 2026-09-23T10:00:00Z');
    expect(container.textContent).toContain('Due: 2026-09-30T10:00:00Z');
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
