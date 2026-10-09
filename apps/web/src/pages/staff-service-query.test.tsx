import { QueryComponentProvider } from '../test/query-provider.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import Electricity from './AdminElectricityOrdersPage.js';
import { AdminConsultationsPage } from './AdminConsultationsPage.js';
import { AdminSolarDocumentsPage } from './AdminSolarDocumentsPage.js';
import { AdminSolarConstructionPage } from './AdminSolarConstructionPage.js';
import { parseListQuery, type ListQueryBinding } from '../hooks/useListQuery.js';
import { solarConstructionQueryOptions } from '../lib/solar-construction-query.js';
import { electricityWork, consultationWork, firstWork } from '../test/staff-business-fixtures.js';
import { solarRequest, solarGuidance } from '../test/solar-staff-fixtures.js';
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ status: 'ready', timezone: 'UTC', format: String, notice: null }),
}));
vi.mock('../components/ContractCancellationRequestQueue.js', () => ({
  ContractCancellationRequestQueue: () => null,
}));
vi.mock('../components/ElectricityRejectionPanel.js', () => ({
  ElectricityRejectionPanel: () => null,
}));
vi.mock('../components/ElectricityRawDraftQueue.js', () => ({
  ElectricityRawDraftQueue: () => null,
}));
vi.mock('../components/OrderWalletBalance.js', () => ({ OrderWalletBalance: () => null }));
let host: HTMLDivElement,
  root: Root,
  kind: string,
  held: boolean,
  signal: AbortSignal,
  finish: (value: unknown) => void;
const constructionQueries = {
  query: parseListQuery({}, solarConstructionQueryOptions),
  setQuery: vi.fn(),
  options: solarConstructionQueryOptions,
} as unknown as ListQueryBinding;
const selected = vi.fn();
const target = (name: string, path: string) =>
  name === 'electricity'
    ? path === '/api/staff/electricity/orders'
    : name === 'consultation'
      ? path.startsWith('/api/admin/consultations/requests?')
      : name === 'documents'
        ? path === '/api/admin/solar/requests'
        : path.startsWith('/api/admin/solar/construction?');
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  window.history.replaceState(null, '', '/');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  held = false;
  selected.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      expect(init?.method ?? 'GET').toBe('GET');
      if (target(kind, path) && !held) {
        held = true;
        signal = init!.signal as AbortSignal;
        return {
          ok: true,
          status: 200,
          json: () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        } as Response;
      }
      if (path.startsWith('/api/staff/electricity/orders'))
        return Response.json({ orders: [], nextAfter: null });
      if (path.endsWith('/consultations/teams')) return Response.json({ teams: [] });
      if (path.startsWith('/api/admin/consultations/requests?'))
        return Response.json({ requests: [], nextAfter: null });
      if (path.includes('document-review-queue'))
        return Response.json({ documents: [], nextBefore: null });
      if (path.endsWith('/document-guidance')) return Response.json(solarGuidance);
      if (path.startsWith('/api/admin/solar/requests'))
        return Response.json({ requests: [], nextBefore: null });
      if (path.startsWith('/api/admin/solar/construction?'))
        return Response.json({ items: [], nextBefore: null });
      throw new Error(`Unexpected ${path}`);
    })
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(name: string | null, actor = 'staff-one') {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        <AccountUserProvider value={actor}>
          {name === 'electricity' ? (
            <Electricity />
          ) : name === 'consultation' ? (
            <AdminConsultationsPage />
          ) : name === 'documents' ? (
            <AdminSolarDocumentsPage />
          ) : name ? (
            <AdminSolarConstructionPage
              queries={constructionQueries}
              selected={null}
              onSelect={selected}
            />
          ) : null}
        </AccountUserProvider>
      </QueryComponentProvider>
    )
  );
}
for (const name of ['electricity', 'consultation', 'documents', 'construction'])
  it.each(['unmount', 'actor', 'profile-context'])(
    'withdraws pending ' + name + ' page bytes on %s without old rows or commands',
    async (change) => {
      kind = name;
      await render(name);
      expect(held).toBe(true);
      expect(signal.aborted).toBe(false);
      const oldSignal = signal,
        oldFinish = finish;
      const count = vi
        .mocked(fetch)
        .mock.calls.filter(([path]) => target(name, String(path))).length;
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('online'));
      });
      expect(
        vi.mocked(fetch).mock.calls.filter(([path]) => target(name, String(path)))
      ).toHaveLength(count);
      if (change === 'unmount') await render(null);
      else if (change === 'actor') await render(name, 'staff-two');
      else await act(async () => refreshProfileContext());
      expect(oldSignal.aborted).toBe(true);
      await act(async () =>
        oldFinish(
          name === 'electricity'
            ? {
                orders: [{ ...electricityWork(), customerName: 'Private obsolete' }],
                nextAfter: null,
              }
            : name === 'consultation'
              ? {
                  requests: [{ ...consultationWork(), profile_name: 'Private obsolete' }],
                  nextAfter: null,
                }
              : name === 'documents'
                ? {
                    requests: [{ ...solarRequest(), profile_name: 'Private obsolete' }],
                    nextBefore: null,
                  }
                : { items: [{ id: firstWork, profileName: 'Private obsolete' }], nextBefore: null }
        )
      );
      expect(host.textContent).not.toContain('Private obsolete');
      expect(selected).not.toHaveBeenCalled();
      expect(
        vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')
      ).toBe(true);
    }
  );

it('retains the selected consultation for a new reviewer while withdrawing old team choices', async () => {
  kind = 'consultation';
  const previous = vi.mocked(fetch).getMockImplementation()!;
  let teamReads = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/consultations/teams')) {
        if (++teamReads === 1) return Response.json({ teams: [{ name: 'Private previous team' }] });
        signal = init!.signal as AbortSignal;
        return {
          ok: true,
          status: 200,
          json: () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        } as Response;
      }
      if (path.startsWith('/api/admin/consultations/requests?'))
        return Response.json({ requests: [consultationWork()], nextAfter: null });
      if (path === `/api/admin/consultations/requests/${firstWork}`)
        return Response.json({ request: consultationWork(), history: [] });
      return previous(input, init);
    })
  );
  await render('consultation');
  const open = [...host.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('First buyer')
  )!;
  expect(open).toBeDefined();
  await act(async () => open.click());
  await vi.waitFor(() => expect(host.querySelector('#consultation-team')).not.toBeNull());
  expect(host.querySelector('#consultation-team')!.textContent).toContain('Private previous team');
  await render('consultation', 'staff-two');
  await vi.waitFor(() => expect(host.querySelector('#consultation-team')).not.toBeNull());
  expect(host.querySelector('#consultation-team')!.textContent).not.toContain(
    'Private previous team'
  );
  expect(host.querySelector('#consultation-fee')).not.toBeNull();
  await act(async () => finish({ teams: [{ name: 'Current reviewer team' }] }));
  expect(host.querySelector('#consultation-team')!.textContent).toContain('Current reviewer team');
  expect(
    vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')
  ).toBe(true);
});
