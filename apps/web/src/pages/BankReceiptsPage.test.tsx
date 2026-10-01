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
      if (url.searchParams.get('statuses') === 'Rejected') {
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

    await act(async () => root.render(<BankReceiptsPage statuses={['Rejected']} />));
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('statuses=Rejected'))).toBe(
      true
    );
    expect(host.querySelectorAll('ul > li')).toHaveLength(1);
    expect(host.querySelector('[aria-label*="{filter}"]')).toBeNull();
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

it('aborts older pages when filters change and ignores a late response', async () => {
  document.documentElement.lang = 'en';
  let resolveOlder!: (response: Response) => void;
  let olderSignal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn((raw: string, init?: RequestInit) => {
      const query = new URL(raw, 'https://app.example.test').searchParams;
      if (query.has('beforeId')) {
        olderSignal = init?.signal as AbortSignal;
        return new Promise<Response>((resolve) => {
          resolveOlder = resolve;
        });
      }
      return Promise.resolve(
        Response.json({
          items: query.has('statuses') ? [secondReceipt] : [firstReceipt],
          nextCursor: query.has('statuses')
            ? null
            : { beforeAt: '2026-09-02T12:00:00.000001Z', beforeId: firstReceipt.receiptId },
        })
      );
    })
  );
  await act(async () => root.render(<BankReceiptsPage />));
  const older = [...host.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('Show older')
  )!;
  await act(async () => older.click());
  await act(async () => root.render(<BankReceiptsPage statuses={['Rejected']} />));
  expect(olderSignal?.aborted).toBe(true);
  await act(async () => resolveOlder(Response.json({ items: [firstReceipt], nextCursor: null })));
  expect(host.textContent).not.toContain(firstReceipt.receiptId);
  expect(host.textContent).toContain(secondReceipt.receiptId);
  expect(host.querySelectorAll('ul > li')).toHaveLength(1);
});

it('keeps exact receipt criteria through ascending pagination and retry', async () => {
  document.documentElement.lang = 'en';
  let failMore = true;
  const requests: URLSearchParams[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (raw: string) => {
      const params = new URL(raw, 'https://app.example.test').searchParams;
      requests.push(params);
      if (params.has('beforeId') && failMore) {
        failMore = false;
        throw new Error('offline');
      }
      return Response.json({
        items: params.has('beforeId') ? [secondReceipt] : [firstReceipt],
        nextCursor: params.has('beforeId')
          ? null
          : { beforeAt: '2026-09-02T12:00:00.000001Z', beforeId: firstReceipt.receiptId },
      });
    })
  );
  await act(async () =>
    root.render(
      <BankReceiptsPage
        query={{ q: 'Bank_%', sort: 'submitted_at:asc' }}
        statuses={['Submitted', 'Rejected']}
        dateRange={{ from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' }}
        amountRange={{ min: '9007199254740993', max: '9007199254740994' }}
      />
    )
  );
  const next = [...host.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Show newer receipts')
  )!;
  await act(async () => next.click());
  expect(host.textContent).toContain(firstReceipt.receiptId);
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  const retry = [...host.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Try again')
  )!;
  await act(async () => retry.click());
  expect(host.textContent).toContain(secondReceipt.receiptId);
  expect(requests).toHaveLength(3);
  for (const params of requests) {
    expect(Object.fromEntries(params)).toMatchObject({
      q: 'Bank_%',
      sort: 'submitted_at:asc',
      statuses: 'Submitted,Rejected',
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-10-01T00:00:00.000Z',
      min: '9007199254740993',
      max: '9007199254740994',
    });
  }
  expect(requests[1]!.toString()).toBe(requests[2]!.toString());
});

it('clears the old receipt scope immediately and rejects late search responses', async () => {
  document.documentElement.lang = 'en';
  let resolveOld!: (response: Response) => void;
  let oldSignal: AbortSignal | undefined;
  const fetcher = vi.fn((raw: string, init?: RequestInit) => {
    if (new URL(raw, 'https://app.example.test').searchParams.get('q') === 'old') {
      oldSignal = init?.signal as AbortSignal;
      return new Promise<Response>((resolve) => {
        resolveOld = resolve;
      });
    }
    return Promise.resolve(Response.json({ items: [secondReceipt], nextCursor: null }));
  });
  vi.stubGlobal('fetch', fetcher);
  await act(async () =>
    root.render(<BankReceiptsPage query={{ q: 'old', sort: 'submitted_at:desc' }} />)
  );
  await act(async () =>
    root.render(<BankReceiptsPage query={{ q: 'current', sort: 'submitted_at:asc' }} />)
  );
  expect(oldSignal?.aborted).toBe(true);
  await act(async () => resolveOld(Response.json({ items: [firstReceipt], nextCursor: null })));
  expect(host.textContent).toContain(secondReceipt.receiptId);
  expect(host.textContent).not.toContain(firstReceipt.receiptId);
  const count = fetcher.mock.calls.length;
  await act(async () =>
    root.render(<BankReceiptsPage query={{ q: 'current', sort: 'submitted_at:asc' }} />)
  );
  expect(fetcher).toHaveBeenCalledTimes(count);
});
