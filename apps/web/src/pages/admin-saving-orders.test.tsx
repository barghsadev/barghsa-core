import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import AdminSavingOrdersPage from './AdminSavingOrdersPage.js';

vi.mock('../components/ContractCancellationRequestQueue.js', () => ({
  ContractCancellationRequestQueue: () => null,
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: (value: string) => value, number: String }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.lang = 'fa';
});

it('loads older review orders and keeps fulfillment separate', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const calls: string[] = [];
  const order = (id: string) => ({
    id,
    customerName: id,
    status: 'awaiting_staff_review',
    billIdentifier: id,
    pricingSnapshot: { plan: { title: { en: 'Saving plan', fa: 'طرح صرفه‌جویی' } } },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url === '/api/user/settings/timezone') return Response.json({ timezone: 'Asia/Tehran' });
      const query = new URL(url, 'http://localhost').searchParams;
      const lane = query.get('lane');
      const after = query.get('after');
      return new Response(
        JSON.stringify(
          lane === 'fulfillment'
            ? { orders: [order('fulfillment-order')], nextAfter: null }
            : after
              ? { orders: [order('older-review')], nextAfter: null }
              : { orders: [order('first-review')], nextAfter: 'first-review' }
        ),
        { headers: { 'Content-Type': 'application/json' } }
      );
    })
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const click = async (label: string) => {
    const button = Array.from(container.querySelectorAll('button')).find(
      (item) => item.textContent?.trim() === label
    );
    expect(button, label).toBeDefined();
    await act(async () => button?.click());
  };
  try {
    await act(async () => root.render(<AdminSavingOrdersPage />));
    expect(container.textContent).toContain('first-review');
    await click('More orders');
    expect(container.textContent).toContain('first-review');
    expect(container.textContent).toContain('older-review');
    expect(calls).toContain('/api/staff/saving/orders?lane=review&after=first-review');
    await click('Fulfillment');
    expect(container.textContent).toContain('fulfillment-order');
    expect(container.textContent).not.toContain('first-review');
    expect(calls).toContain('/api/staff/saving/orders?lane=fulfillment');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
