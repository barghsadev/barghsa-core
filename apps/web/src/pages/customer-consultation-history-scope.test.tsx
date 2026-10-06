import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ConsultationsPage } from './ConsultationsPage.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { DEFAULT_HISTORY_SORT } from '@barghsa/shared/validation';
import { refreshProfileContext } from '../lib/profile-context.js';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({
    children,
    to,
    params,
  }: {
    children: ReactNode;
    to: string;
    params?: { requestId: string };
  }) => <a href={params ? to.replace('$requestId', params.requestId) : to}>{children}</a>,
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
const row = (id = first) => ({
  id,
  status: 'submitted',
  product_snapshot: { title: { en: 'Owned consultation', fa: 'مشاوره' } },
  submitted_at: '2026-10-05T10:00:00.000Z',
  staff_owner_username: null,
  staff_owner_id: 'private-owner-id',
  staff_team: null,
  expected_next_step: null,
  invoice_id: null,
  invoice_state: null,
  accepted_at: null,
  offer_valid_until: null,
  refund_pending: false,
});
const scenarios = [
  {
    name: 'consultation',
    Page: ConsultationsPage,
    api: '/api/consultations/requests',
    key: 'requests',
  },
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
            return Response.json({
              activeProfileId: profile,
              profiles: [
                { id: profile, profileType: 'INDIVIDUAL', firstName: 'Buyer', lastName: 'A' },
              ],
            });
          }
          if (url.pathname === '/api/consultations/products')
            return Response.json({ products: [] });
          if (url.pathname === scenario.api) {
            if (denied && location === 'resource') return Response.json({}, { status });
            return Response.json({ [scenario.key]: [row()], nextBefore: first });
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
            <AccountUserProvider value="customer-1">
              <Page query={{ q: 'saved filter', sort: DEFAULT_HISTORY_SORT }} />
            </AccountUserProvider>
          )
        );
        await settled(() =>
          expect(host.querySelector(`a[href="/consultations/${first}"]`)).not.toBeNull()
        );
        expect(host.textContent).toContain('Assigned staff');
        expect(host.textContent).not.toContain('private-owner-id');
        const more = host.querySelector<HTMLButtonElement>(
          'nav[aria-label="History pages"] button'
        );
        expect(more).not.toBeNull();
        denied = true;
        await act(async () => more!.click());
        await settled(() => expect(host.querySelector('[role=alert]')).not.toBeNull());
        expect(host.querySelector(`a[href="/consultations/${first}"]`)).toBeNull();
        expect(host.querySelector('nav[aria-label="History pages"]')).toBeNull();
        const deniedReads = requests.filter((url) => url.pathname === scenario.api).length;
        if (location === 'profile') expect(deniedReads).toBe(1);
        denied = false;
        const retry = host.querySelector<HTMLButtonElement>(
          location === 'profile' ? '[role=alert] button' : '[data-slot=list-content] button'
        );
        expect(retry).not.toBeNull();
        await act(async () => retry!.click());
        await settled(() =>
          expect(host.querySelector(`a[href="/consultations/${first}"]`)).not.toBeNull()
        );
        const last = requests.filter((url) => url.pathname === scenario.api).at(-1)!;
        expect(last.searchParams.get('q')).toBe('saved filter');
        expect(last.searchParams.has('before')).toBe(false);
        expect(last.searchParams.get('profileId')).toBe(profile);
      });
    }

const profileB = '89000000-0000-4000-8000-000000000004';
const currentRow = '89000000-0000-4000-8000-000000000005';
function heldReply() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const profileReply = (active: string | null) =>
  Response.json({
    activeProfileId: active,
    profiles: active
      ? [
          {
            id: active,
            profileType: 'INDIVIDUAL',
            firstName: 'Buyer',
            lastName: active === profile ? 'A' : 'B',
          },
        ]
      : [],
  });
const pageReply = (id: string, nextBefore: string | null = first) =>
  Response.json({ requests: [row(id)], nextBefore });
const link = (id: string) => host.querySelector(`a[href="/consultations/${id}"]`);
const more = () => host.querySelector<HTMLButtonElement>('nav[aria-label="History pages"] button')!;
async function start(handler: (input: string) => Promise<Response>) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(handler));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <AccountUserProvider value="account-a">
        <ConsultationsPage query={{ q: 'saved', sort: 'submitted_at:asc' }} />
      </AccountUserProvider>
    )
  );
  await settled(() => expect(link(first)).not.toBeNull());
}

it.each(['account', 'profile'] as const)(
  'fences a late history success after a %s change and keeps profile ownership coherent',
  async (kind) => {
    let active = profile;
    const held = heldReply();
    const reads: URL[] = [];
    await start(async (input) => {
      const url = new URL(input, 'http://localhost');
      if (url.pathname === '/api/profiles') return profileReply(active);
      if (url.pathname === '/api/consultations/products') return Response.json({ products: [] });
      reads.push(url);
      if (active === profile && url.searchParams.has('before')) return held.promise;
      return active === profile ? pageReply(first) : pageReply(currentRow, null);
    });
    await act(async () => more().click());
    active = profileB;
    await act(async () => {
      if (kind === 'account')
        root!.render(
          <AccountUserProvider value="account-b">
            <ConsultationsPage query={{ q: 'saved', sort: 'submitted_at:asc' }} />
          </AccountUserProvider>
        );
      else refreshProfileContext();
    });
    expect(link(first)).toBeNull();
    await settled(() => expect(link(currentRow)).not.toBeNull());
    expect(host.textContent).toContain('Buyer B');
    await act(async () => held.resolve(pageReply(first, null)));
    expect(link(first)).toBeNull();
    expect(link(currentRow)).not.toBeNull();
    const fresh = reads.filter((url) => url.searchParams.get('profileId') === profileB);
    expect(fresh).toHaveLength(1);
    expect(fresh[0]!.searchParams.has('before')).toBe(false);
    expect(fresh[0]!.searchParams.get('q')).toBe('saved');
  }
);

it('ignores a late denial before the new profile render', async () => {
  let active = profile;
  const held = heldReply();
  await start(async (input) => {
    const url = new URL(input, 'http://localhost');
    if (url.pathname === '/api/profiles') return profileReply(active);
    if (url.pathname === '/api/consultations/products') return Response.json({ products: [] });
    if (active === profile && url.searchParams.has('before')) return held.promise;
    return active === profile ? pageReply(first) : pageReply(currentRow, null);
  });
  await act(async () => more().click());
  active = profileB;
  await act(async () => {
    refreshProfileContext();
    held.resolve(Response.json({}, { status: 403 }));
  });
  await settled(() => expect(link(currentRow)).not.toBeNull());
  expect(link(first)).toBeNull();
  expect(host.querySelector('[role=alert]')).toBeNull();
});

it.each(['missing', 'changed'] as const)(
  'withdraws old history and intake profile when its active profile is %s without a broadcast',
  async (kind) => {
    let active: string | null = profile;
    const held = heldReply();
    const reads: URL[] = [];
    await start(async (input) => {
      const url = new URL(input, 'http://localhost');
      if (url.pathname === '/api/profiles') return profileReply(active);
      if (url.pathname === '/api/consultations/products') return Response.json({ products: [] });
      reads.push(url);
      return active === profile ? pageReply(first) : held.promise;
    });
    active = kind === 'missing' ? null : profileB;
    await act(async () => more().click());
    expect(link(first)).toBeNull();
    if (kind === 'missing') {
      expect(reads).toHaveLength(1);
      expect(host.textContent).not.toContain('Buyer A');
      expect(host.querySelector('[role=status]')).toBeNull();
    } else {
      await settled(() =>
        expect(reads.some((url) => url.searchParams.get('profileId') === profileB)).toBe(true)
      );
      expect(host.textContent).toContain('Buyer B');
      expect(host.textContent).not.toContain('Buyer A');
      const request = reads.at(-1)!;
      expect(request.searchParams.has('before')).toBe(false);
      expect(request.searchParams.get('q')).toBe('saved');
      await act(async () => held.resolve(pageReply(currentRow, null)));
      await settled(() => expect(link(currentRow)).not.toBeNull());
      expect(host.querySelector('[role=status]')).toBeNull();
    }
  }
);

it('retains accepted history and the exact cursor after a malformed profile read', async () => {
  let malformed = false;
  const reads: URL[] = [];
  await start(async (input) => {
    const url = new URL(input, 'http://localhost');
    if (url.pathname === '/api/profiles')
      return malformed ? Response.json({ activeProfileId: profile }) : profileReply(profile);
    if (url.pathname === '/api/consultations/products') return Response.json({ products: [] });
    reads.push(url);
    return url.searchParams.has('before') ? pageReply(currentRow, null) : pageReply(first);
  });
  malformed = true;
  await act(async () => more().click());
  await settled(() => expect(host.querySelector('[role=alert]')).not.toBeNull());
  expect(link(first)).not.toBeNull();
  expect(reads).toHaveLength(1);
  malformed = false;
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-slot=list-content] button')!.click()
  );
  await settled(() => expect(link(currentRow)).not.toBeNull());
  expect(link(first)).not.toBeNull();
  expect(reads.at(-1)!.searchParams.get('before')).toBe(first);
  expect(reads.at(-1)!.searchParams.get('q')).toBe('saved');
});
