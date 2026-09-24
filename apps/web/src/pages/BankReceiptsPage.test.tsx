import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BankReceiptsPage } from './BankReceiptsPage.js';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    hash,
  }: {
    children: ReactNode;
    to: string;
    params?: { invoiceId: string };
    hash?: string;
  }) => (
    <a
      href={`${params ? to.replace('$invoiceId', params.invoiceId) : to}${hash ? `#${hash}` : ''}`}
    >
      {children}
    </a>
  ),
}));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ notice: null, format: (value: string) => value }),
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const firstReceipt = {
  receiptId: '11111111-1111-4111-8111-111111111111',
  invoiceId: '22222222-2222-4222-8222-222222222222',
  amount: '9007199254740993',
  bankName: 'Bank Mellat',
  state: 'Submitted',
  paymentDate: '2026-09-01',
  submittedAt: '2026-09-02T12:00:00Z',
};
const secondReceipt = {
  ...firstReceipt,
  receiptId: '33333333-3333-4333-8333-333333333333',
  invoiceId: '44444444-4444-4444-8444-444444444444',
  amount: '500',
  bankName: null,
  state: 'Rejected',
};

it.each(['en', 'fa'] as const)(
  'pages receipts across invoices and opens their detail in %s',
  async (locale) => {
    document.documentElement.lang = locale;
    const fetcher = vi.fn(async (raw: string) => {
      const url = new URL(raw, 'https://app.example.test');
      if (url.searchParams.get('state') === 'Rejected') {
        return Response.json({ items: [secondReceipt], nextCursor: null });
      }
      if (url.searchParams.has('beforeAt')) {
        expect(url.searchParams.get('beforeAt')).toBe('2026-09-02T12:00:00.000001Z');
        return Response.json({ items: [secondReceipt], nextCursor: null });
      }
      return Response.json({
        items: [firstReceipt],
        nextCursor: {
          beforeAt: '2026-09-02T12:00:00.000001Z',
          beforeId: firstReceipt.receiptId,
        },
      });
    });
    vi.stubGlobal('fetch', fetcher);
    await act(async () => root.render(<BankReceiptsPage />));
    expect(host.textContent).toContain('Bank Mellat');
    expect(host.textContent).toContain(firstReceipt.invoiceId);
    expect(
      host.querySelector(
        `a[href="/invoices/${firstReceipt.invoiceId}#bank-receipt-${firstReceipt.receiptId}"]`
      )
    ).not.toBeNull();
    expect(host.textContent).toContain(locale === 'en' ? 'Bank receipts' : 'رسیدهای بانکی');
    expect(host.textContent).not.toContain('invoices.receipts.');
    const older = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.includes(locale === 'en' ? 'Show older' : 'قدیمی‌تر')
    );
    expect(older).toBeDefined();
    await act(async () => older!.click());
    expect(host.querySelectorAll('ul > li')).toHaveLength(2);
    expect(host.textContent).toContain(secondReceipt.invoiceId);
    expect(host.textContent).toContain(locale === 'en' ? 'Not provided' : 'ثبت نشده');

    const select = host.querySelector<HTMLSelectElement>('#bank-receipt-state')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(
        select,
        'Rejected'
      );
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('state=Rejected'))).toBe(true);
    expect(host.querySelectorAll('ul > li')).toHaveLength(1);
    expect(host.textContent).not.toContain(firstReceipt.receiptId);
  }
);

it('offers a retry after the initial receipt request fails', async () => {
  document.documentElement.lang = 'en';
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(Response.json({ items: [], nextCursor: null }));
  vi.stubGlobal('fetch', fetcher);
  await act(async () => root.render(<BankReceiptsPage />));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not load receipts');
  const retry = [...host.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('Try again')
  );
  await act(async () => retry!.click());
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain('No receipts match');
});
