import { getProfileContextRevision } from '../lib/profile-context.js';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { QueryProvider } from '../test/query-provider.js';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { BankReceiptsPage } from './BankReceiptsPage.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { DEFAULT_HISTORY_SORT } from '@barghsa/shared/validation';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/test-link">{children}</a>,
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({
    status: 'ready',
    timezone: 'Asia/Tehran',
    format: String,
    notice: null,
  }),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({
    irrDigits: String,
    money: String,
    number: String,
    numberStyle: 'western',
  }),
}));
const first = '89000000-0000-4000-8000-000000000001';
const profile = '89000000-0000-4000-8000-000000000002';
const beforeAt = '2026-10-05T10:00:00.000001Z';
const row = (id = first) => ({
  receiptId: id,
  invoiceId: profile,
  amount: '9007199254740993',
  bankName: 'Receipt bank',
  state: 'Submitted',
  paymentDate: '2026-10-01',
  submittedAt: '2026-10-05T10:00:00.000Z',
});
const scenarios = [
  { name: 'bank receipt', Page: BankReceiptsPage, api: '/api/invoices/bank-receipts' },
] as const;
let root: Root | undefined, host: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  vi.unstubAllGlobals();
  localStorage.clear();
});
async function settled(check: () => void) {
  await vi.waitFor(async () => {
    await act(async () => {});
    check();
  });
}
for (const scenario of scenarios)
  for (const location of ['resource', 'profile'] as const)
    for (const status of [401, 403]) {
      it(`discards ${scenario.name} history after ${location} ${status} and retries from the first page`, async () => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        const requests: URL[] = [];
        let denied = false;
        const fetchMock = vi.fn(async (input: string) => {
          const url = new URL(input, 'http://localhost');
          requests.push(url);
          if (url.pathname.startsWith('/api/profiles')) {
            if (denied && location === 'profile') return Response.json({}, { status });
            return Response.json({ activeProfileId: profile });
          }
          if (url.pathname === scenario.api) {
            if (denied && location === 'resource') return Response.json({}, { status });
            return Response.json({ items: [row()], nextCursor: { beforeAt, beforeId: first } });
          }
          return Response.json({}, { status: 404 });
        });
        vi.stubGlobal('fetch', fetchMock);
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        const Page = scenario.Page;
        await act(async () =>
          root!.render(
            <QueryProvider>
              <AccountUserProvider value="customer-1">
                <Page
                  statuses={['Submitted', 'Rejected']}
                  dateRange={{ from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z' }}
                  amountRange={{ min: '100000', max: '9007199254740993' }}
                  query={{ q: 'saved filter', sort: DEFAULT_HISTORY_SORT }}
                />
              </AccountUserProvider>
            </QueryProvider>
          )
        );
        await settled(() => expect(host.textContent).toContain(first));
        const more = host.querySelector<HTMLButtonElement>(
          'nav[aria-label="History pages"] button'
        );
        expect(more).not.toBeNull();
        denied = true;
        await act(async () => more!.click());
        await settled(() => expect(host.querySelector('[role=alert]')).not.toBeNull());
        expect(host.textContent).not.toContain(first);
        expect(host.querySelector('nav[aria-label="History pages"]')).toBeNull();
        const deniedReads = requests.filter((url) => url.pathname === scenario.api).length;
        if (location === 'profile') expect(deniedReads).toBe(1);
        denied = false;
        const retry = host.querySelector<HTMLButtonElement>('[data-slot=list-content] button');
        expect(retry).not.toBeNull();
        await act(async () => retry!.click());
        await settled(() => expect(host.textContent).toContain(first));
        const last = requests.filter((url) => url.pathname === scenario.api).at(-1)!;
        expect(last.searchParams.get('q')).toBe('saved filter');
        expect(last.searchParams.has('beforeAt')).toBe(false);
        expect(last.searchParams.has('beforeId')).toBe(false);
        expect(last.searchParams.has('profileId')).toBe(false);
        expect(last.searchParams.get('statuses')).toBe('Submitted,Rejected');
        expect(last.searchParams.get('from')).toBe('2026-10-01T00:00:00Z');
        expect(last.searchParams.get('to')).toBe('2026-11-01T00:00:00Z');
        expect(last.searchParams.get('min')).toBe('100000');
        expect(last.searchParams.get('max')).toBe('9007199254740993');
      });
    }

it('keeps receipt reads manual, forwards cancellation and preserves the exact compound cursor', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let client!: QueryClient;
  const keys: Array<readonly unknown[]> = [];
  function Probe() {
    client = useQueryClient();
    return null;
  }
  const requests: { url: URL; signal: AbortSignal | null | undefined }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      requests.push({ url, signal: init?.signal });
      keys.push([
        ...client
          .getQueryCache()
          .getAll()
          .find((query) => query.state.fetchStatus === 'fetching')!.queryKey,
      ]);
      expect(init?.credentials).toBe('include');
      if (url.pathname === '/api/profiles') return Response.json({ activeProfileId: profile });
      return Response.json({ items: [row()], nextCursor: { beforeAt, beforeId: first } });
    })
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <QueryProvider>
        <Probe />
        <AccountUserProvider value="customer-1">
          <BankReceiptsPage />
        </AccountUserProvider>
      </QueryProvider>
    )
  );
  await settled(() => expect(host.textContent).toContain(first));
  expect(host.textContent).toContain('9007199254740993');
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(requests).toHaveLength(2);
  expect(keys.map((key) => key.slice(0, 7))).toEqual([
    [
      'barghsa',
      'profiles',
      'account',
      'customer-1',
      getProfileContextRevision(),
      'customer-1',
      'authority',
    ],
    ['barghsa', 'invoices', 'customer', profile, getProfileContextRevision(), 'customer-1', 'list'],
  ]);
  await act(async () =>
    host.querySelector<HTMLButtonElement>('nav[aria-label="History pages"] button')!.click()
  );
  await settled(() => expect(requests).toHaveLength(4));
  expect(JSON.stringify(keys[2])).not.toBe(JSON.stringify(keys[0]));
  expect(keys[3]!.slice(0, 8)).toEqual(keys[1]!.slice(0, 8));
  expect(JSON.stringify(keys[3])).not.toBe(JSON.stringify(keys[1]));
  expect(requests[2]!.url.pathname).toBe('/api/profiles');
  expect(requests[3]!.url.searchParams.get('beforeAt')).toBe(beforeAt);
  expect(requests[3]!.url.searchParams.get('beforeId')).toBe(first);
  expect(requests[3]!.url.searchParams.has('profileId')).toBe(false);
  expect(requests.every((request) => request.signal instanceof AbortSignal)).toBe(true);
  expect(new Set(requests.map((request) => request.signal)).size).toBe(4);
  expect(host.textContent?.split(first).length).toBe(2);
});

it('cancels an old account page and refuses its late denial without withdrawing replacement rows', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let finish!: (response: Response) => void,
    signal: AbortSignal | null | undefined,
    pages = 0;
  const replacement = '89000000-0000-4000-8000-000000000003';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      if (url.pathname === '/api/profiles') return Response.json({ activeProfileId: profile });
      if (++pages === 1) {
        signal = init?.signal;
        return new Promise<Response>((done) => {
          finish = done;
        });
      }
      return Response.json({ items: [row(replacement)], nextCursor: null });
    })
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const render = async (actor: string) =>
    act(async () =>
      root!.render(
        <QueryProvider>
          <AccountUserProvider value={actor}>
            <BankReceiptsPage />
          </AccountUserProvider>
        </QueryProvider>
      )
    );
  await render('customer-1');
  await settled(() => expect(pages).toBe(1));
  await render('replacement-customer');
  await settled(() => expect(host.textContent).toContain(replacement));
  expect(signal?.aborted).toBe(true);
  await act(async () => finish(Response.json({}, { status: 403 })));
  expect(host.textContent).toContain(replacement);
  expect(host.querySelector('[role=alert]')).toBeNull();
  expect(pages).toBe(2);
});

it('unmount aborts a pending receipt authority read', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let finish!: (response: Response) => void, signal: AbortSignal | null | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: string, init?: RequestInit) => {
      signal = init?.signal;
      return new Promise<Response>((done) => {
        finish = done;
      });
    })
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <QueryProvider>
        <AccountUserProvider value="customer-1">
          <BankReceiptsPage />
        </AccountUserProvider>
      </QueryProvider>
    )
  );
  await act(async () => root!.unmount());
  root = undefined;
  expect(signal?.aborted).toBe(true);
  await act(async () => finish(Response.json({ activeProfileId: profile })));
  expect(host.textContent).toBe('');
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
});
