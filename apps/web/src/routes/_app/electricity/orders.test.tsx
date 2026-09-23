import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ElectricityOrdersPage } from './orders.index.js';

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  Link: ({
    children,
    to,
    params,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
  }) => {
    const href = Object.entries(params ?? {}).reduce(
      (path, [key, value]) => path.replace(`$${key}`, encodeURIComponent(value)),
      to
    );
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
}));

vi.mock('../../../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: String, irrDigits: String }),
}));

it('keeps earlier profile orders visible when more history loads', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const request = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url === '/api/profiles/verification-status'
            ? { activeProfileId: 'profile-1' }
            : url.includes('before=page-2')
              ? {
                  orders: [
                    {
                      orderId: 'order-2',
                      electricityStatus: 'active',
                      financialStatus: 'paid',
                      nextAction: 'await_delivery',
                      submittedAt: '2026-09-22T00:00:00Z',
                      periodStart: '2026-09-24T00:00:00Z',
                      periodEnd: '2026-09-30T00:00:00Z',
                      totalKwh: '20',
                      totalIrR: '5000000',
                    },
                  ],
                  nextBefore: null,
                }
              : {
                  orders: [
                    {
                      orderId: 'order-1',
                      electricityStatus: 'awaiting_staff_review',
                      financialStatus: 'unpaid',
                      nextAction: 'await_review',
                      submittedAt: '2026-09-23T00:00:00Z',
                      periodStart: '2026-09-24T00:00:00Z',
                      periodEnd: '2026-09-30T00:00:00Z',
                      totalKwh: '10',
                      totalIrR: '2500000',
                    },
                  ],
                  nextBefore: 'page-2',
                }
        ),
        { headers: { 'Content-Type': 'application/json' } }
      )
  );
  vi.stubGlobal('fetch', request);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<ElectricityOrdersPage />));
    expect(request).toHaveBeenCalledWith(
      '/api/electricity/orders?profileId=profile-1',
      expect.any(Object)
    );
    expect(container.textContent).toContain('Awaiting staff review');
    expect(container.textContent).toContain('Unpaid');
    expect(container.textContent).toContain('2500000');
    expect(container.textContent).toContain('order-1');
    expect(container.querySelector('a[href="/electricity/orders/order-1"]')).not.toBeNull();
    const more = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'More orders'
    );
    expect(more).toBeDefined();
    await act(async () => more!.click());
    expect(request).toHaveBeenCalledWith(
      '/api/electricity/orders?profileId=profile-1&before=page-2',
      expect.any(Object)
    );
    expect(container.querySelector('a[href="/electricity/orders/order-1"]')).not.toBeNull();
    expect(container.querySelector('a[href="/electricity/orders/order-2"]')).not.toBeNull();
    expect(container.textContent).toContain('Paid');
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
