import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SavingOrderChangePanel } from './SavingOrderChangePanel.js';

vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

let container: HTMLDivElement;
let root: Root;
const changed = vi.fn();
const requests: Array<{ url: string; body: Record<string, string> }> = [];

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  changed.mockReset();
  requests.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, string>;
        requests.push({ url, body });
        return {
          ok: true,
          json: async () =>
            url.endsWith('change-quote')
              ? {
                  reviewDigest: 'a'.repeat(64),
                  subtotalIrR: '400000',
                  discountIrR: '30000',
                  vatIrR: '8325',
                  totalIrR: '378325',
                }
              : { savingOrderId: 'order' },
        };
      }
      return {
        ok: true,
        json: async () =>
          url === '/api/saving/plans'
            ? {
                plans: [
                  {
                    id: 'plan',
                    hardware: [
                      { id: 'current', title: { fa: 'فعلی', en: 'Current' }, status: 'active' },
                      {
                        id: 'next',
                        title: { fa: 'جدید', en: 'Next' },
                        status: 'active',
                        stock_tracking: true,
                        available_count: 1,
                      },
                      {
                        id: 'empty',
                        title: { fa: 'ناموجود', en: 'Empty' },
                        status: 'active',
                        stock_tracking: true,
                        available_count: 0,
                      },
                    ],
                  },
                ],
              }
            : {
                addresses: [
                  { id: 'old-address', fullAddress: 'Old street', postalCode: '1234567890' },
                  { id: 'new-address', fullAddress: 'New street', postalCode: '9876543210' },
                ],
              },
      };
    })
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('previews and confirms one equipment and address change with the reviewed digest', async () => {
  await act(async () =>
    root.render(
      <SavingOrderChangePanel
        orderId="order"
        profileId="profile"
        planId="plan"
        currentHardwareId="current"
        currentAddressId="old-address"
        onChanged={changed}
      />
    )
  );
  expect((container.querySelector('option[value="empty"]') as HTMLOptionElement).disabled).toBe(
    true
  );
  const selects = container.querySelectorAll('select');
  await act(async () => {
    selects[0]!.value = 'next';
    selects[0]!.dispatchEvent(new Event('change', { bubbles: true }));
    selects[1]!.value = 'new-address';
    selects[1]!.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const click = async (text: string) => {
    const button = [...container.querySelectorAll('button')].find(
      (item) => item.textContent === text
    );
    expect(button).toBeTruthy();
    await act(async () => button!.click());
  };
  await click('Review new price');
  expect(container.textContent).toContain('Your existing gift discount remains applied.');
  expect(requests[0]).toEqual({
    url: '/api/saving/orders/order/change-quote',
    body: { hardwareProductId: 'next', installationAddressId: 'new-address' },
  });
  await click('Confirm changes');
  expect(requests[1]).toMatchObject({
    url: '/api/saving/orders/order/change',
    body: {
      hardwareProductId: 'next',
      installationAddressId: 'new-address',
      expectedQuoteDigest: 'a'.repeat(64),
      idempotencyKey: expect.any(String),
    },
  });
  expect(changed).toHaveBeenCalledOnce();
});
