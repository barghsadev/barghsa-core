import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import AdminGiftCodesPage from './AdminGiftCodesPage.js';

vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useTimezone.js', () => ({
  useTimezone: () => ({ status: 'ready', timezone: 'Asia/Tehran', retry: vi.fn() }),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: String, number: String, percent: String }),
}));

function code(index: number) {
  return {
    id: `00000000-0000-7000-8000-${String(index).padStart(12, '0')}`,
    code: `CODE${String(index).padStart(2, '0')}`,
    discountType: 'fixed_irr',
    discountValue: '1000',
    maxCapIrr: null,
    eligibility: 'public',
    profileIds: [],
    totalLimit: null,
    perProfileLimit: null,
    validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: null,
    minOrderAmount: '0',
    categories: [],
    restoreOnCancel: true,
    restoreAfterPayment: false,
    status: 'active',
    createdBy: 'staff-1',
    createdAt: '2026-09-24T00:00:00.000Z',
    updatedAt: '2026-09-24T00:00:00.000Z',
    usage: { consumed: 1, released: 1, totalDiscountIrr: '1000' },
  };
}

it('loads another code page and shows per-profile usage with restoration history', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const firstPage = Array.from({ length: 50 }, (_, index) => code(index));
  const fetchMock = vi.fn(async (url: string) => {
    const data = url.includes('/stats')
      ? {
          code: code(0),
          perProfile: [
            {
              profileId: '11111111-1111-4111-8111-111111111111',
              profileTitle: 'Customer One',
              consumed: 1,
              released: 1,
              discountIrr: '1000',
            },
          ],
          recentRedemptions: [
            {
              id: '22222222-2222-4222-8222-222222222222',
              giftCodeId: code(0).id,
              profileId: '11111111-1111-4111-8111-111111111111',
              orderId: '33333333-3333-4333-8333-333333333333',
              discountAmount: '1000',
              status: 'released',
              createdAt: '2026-09-24T00:00:00.000Z',
              restoredAt: '2026-09-24T01:00:00.000Z',
            },
          ],
        }
      : url.includes('before=')
        ? [code(50)]
        : firstPage;
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<AdminGiftCodesPage />));
    expect(container.textContent).toContain('CODE00');
    const more = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Load more codes'
    );
    expect(more).toBeDefined();
    await act(async () => more!.click());
    expect(container.textContent).toContain('CODE50');
    expect(fetchMock.mock.calls.some(([url]) => url.includes('before='))).toBe(true);

    const edit = container.querySelector<HTMLButtonElement>('button[aria-label="Edit CODE00"]');
    expect(edit).not.toBeNull();
    await act(async () => edit!.click());
    expect(container.textContent).toContain('CODE50');
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('?limit=50'))).toHaveLength(2);
    expect(container.textContent).toContain('Usage statistics');
    expect(container.textContent).toContain('Customer One');
    expect(container.textContent).toContain('Restored');

    const eligible = container.querySelector<HTMLSelectElement>('#gift-eligibility-filter')!;
    const expiry = container.querySelector<HTMLSelectElement>('#gift-expiry-filter')!;
    await act(async () => {
      eligible.value = 'profile';
      eligible.dispatchEvent(new Event('change', { bubbles: true }));
      expiry.value = 'expired';
      expiry.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const filters = container.querySelector<HTMLFormElement>(
      'form[aria-label="Gift-code filters"]'
    )!;
    await act(async () =>
      filters.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    expect(
      fetchMock.mock.calls.some(
        ([url]) => url.includes('eligibility=profile') && url.includes('expiry=expired')
      )
    ).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
