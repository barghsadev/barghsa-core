import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { QuickStatusCards } from './QuickStatusCards.js';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search,
    className,
  }: {
    children: ReactNode;
    to: string;
    search?: { status?: string; state?: string };
    className?: string;
  }) => (
    <a
      href={
        search?.status
          ? `${to}?status=${search.status}`
          : search?.state
            ? `${to}?state=${search.state}`
            : to
      }
      className={className}
    >
      {children}
    </a>
  ),
}));

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function renderCards(locale: 'en' | 'fa') {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <QuickStatusCards
        locale={locale}
        activeContracts={2}
        pendingOrders={3}
        openTickets={1}
        unpaidInvoices={4}
      />
    );
  });
  cleanup = async () => {
    await act(async () => root.unmount());
    container.remove();
  };
  return container;
}

it.each(['en', 'fa'] as const)(
  'routes %s dashboard counts to their business lists',
  async (locale) => {
    const container = await renderCards(locale);
    const paths = [...container.querySelectorAll('a')].map((link) => link.getAttribute('href'));
    expect(paths).toEqual([
      '/contracts?state=Active',
      '/electricity/orders?status=pending',
      '/savings/orders?status=pending',
      '/tickets',
      '/invoices?status=unpaid',
    ]);
    expect(container.querySelector('[dir]')?.getAttribute('dir')).toBe(
      locale === 'fa' ? 'rtl' : 'ltr'
    );
  }
);
