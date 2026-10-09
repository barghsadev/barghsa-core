import { QueryComponentProvider } from '../test/query-provider.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { SavingOrderChangePanel } from './SavingOrderChangePanel.js';
import { SavingOrderComments, ElectricityOrderComments } from './SavingOrderComments.js';
import AdminSavingOrdersPage from '../pages/AdminSavingOrdersPage.js';
import { source, plans, addresses, ids } from '../lib/saving-change-form.fixtures.js';
import { firstWork, savingWork } from '../test/staff-business-fixtures.js';
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ status: 'ready', timezone: 'UTC', format: String, notice: null }),
}));
vi.mock('./OrderWalletBalance.js', () => ({ OrderWalletBalance: () => null }));
vi.mock('./SavingOrderDocuments.js', () => ({ SavingOrderDocuments: () => null }));
vi.mock('./ContractCancellationRequestQueue.js', () => ({
  ContractCancellationRequestQueue: () => null,
}));
let host: HTMLDivElement, root: Root;
let owner: string, held: boolean, signal: AbortSignal, finish: (value: unknown) => void;
const changed = vi.fn(),
  withdrawn = vi.fn();
const matches = (kind: string, url: string) =>
  kind === 'plans'
    ? url === '/api/saving/plans'
    : kind === 'addresses'
      ? url === `/api/profiles/${ids.profileId}/addresses`
      : kind === 'staff-queue'
        ? url.startsWith('/api/staff/saving/orders?')
        : kind === 'staff-detail'
          ? url === `/api/staff/saving/orders/${firstWork}`
          : kind === 'saving-comments'
            ? url === `/api/saving/orders/${ids.orderId}/comments`
            : url === `/api/electricity/orders/${ids.orderId}/comments`;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  held = false;
  changed.mockReset();
  withdrawn.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method && init.method !== 'GET') throw new Error('Unexpected command');
      if (matches(owner, url) && !held) {
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
      if (url === '/api/saving/plans') return Response.json(plans);
      if (url.includes('/addresses')) return Response.json(addresses);
      if (url.endsWith('/comments')) return Response.json({ comments: [], nextBefore: null });
      if (url.startsWith('/api/staff/saving/orders?'))
        return Response.json({ orders: [savingWork()], nextAfter: null });
      if (url === `/api/staff/saving/orders/${firstWork}`) return Response.json(savingWork());
      throw new Error(`Unexpected ${url}`);
    })
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(kind: string | null, actor = '33333333-3333-4333-8333-333333333333') {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        <AccountUserProvider value={actor}>
          {kind === 'staff-queue' || kind === 'staff-detail' ? (
            <AdminSavingOrdersPage />
          ) : kind === 'saving-comments' ? (
            <SavingOrderComments
              orderId={ids.orderId}
              profileId={ids.profileId}
              formatTimestamp={String}
            />
          ) : kind === 'electricity-comments' ? (
            <ElectricityOrderComments
              orderId={ids.orderId}
              profileId={ids.profileId}
              formatTimestamp={String}
            />
          ) : kind ? (
            <SavingOrderChangePanel {...source} onChanged={changed} onWithdrawal={withdrawn} />
          ) : null}
        </AccountUserProvider>
      </QueryComponentProvider>
    )
  );
}
for (const kind of [
  'plans',
  'addresses',
  'staff-queue',
  'staff-detail',
  'saving-comments',
  'electricity-comments',
]) {
  it.each(['unmount', 'actor', 'profile-context'])(
    'cancels ' + kind + ' bytes on %s and refuses obsolete values',
    async (change) => {
      owner = kind;
      await render(kind);
      if (kind === 'staff-detail') {
        const open = [...host.querySelectorAll('button')].find((button) =>
          button.textContent?.includes('First buyer')
        )!;
        expect(open).toBeDefined();
        await act(async () => open.click());
      }
      expect(held).toBe(true);
      expect(signal.aborted).toBe(false);
      const oldSignal = signal,
        oldFinish = finish;
      const count = vi
        .mocked(fetch)
        .mock.calls.filter(([url]) => matches(kind, String(url))).length;
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('online'));
      });
      expect(
        vi.mocked(fetch).mock.calls.filter(([url]) => matches(kind, String(url)))
      ).toHaveLength(count);
      if (change === 'unmount') await render(null);
      else if (change === 'actor') await render(kind, '44444444-4444-4444-8444-444444444444');
      else await act(async () => refreshProfileContext());
      expect(oldSignal.aborted).toBe(true);
      const row = { ...savingWork(), customerName: 'Private obsolete' };
      const oldValue =
        kind === 'plans'
          ? {
              plans: plans.plans.map((plan) => ({
                ...plan,
                hardware: plan.hardware.map((hardware) => ({
                  ...hardware,
                  title: { en: 'Private obsolete', fa: 'Private obsolete' },
                })),
              })),
            }
          : kind === 'addresses'
            ? {
                addresses: addresses.addresses.map((address) => ({
                  ...address,
                  fullAddress: 'Private obsolete',
                })),
              }
            : kind === 'staff-queue'
              ? { orders: [row], nextAfter: null }
              : kind === 'staff-detail'
                ? row
                : {
                    comments: [
                      {
                        id: '55555555-5555-4555-8555-555555555555',
                        orderId: ids.orderId,
                        authorUserId: '33333333-3333-4333-8333-333333333333',
                        authorName: 'Author',
                        authorRole: 'customer',
                        body: 'Private obsolete',
                        createdAt: '2026-10-05T10:00:00.123Z',
                        ...(kind === 'electricity-comments' ? { visibility: 'public' } : {}),
                      },
                    ],
                    nextBefore: null,
                  };
      await act(async () => oldFinish(oldValue));
      expect(host.textContent).not.toContain('Private obsolete');
      expect(
        vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')
      ).toBe(true);
      expect(changed).not.toHaveBeenCalled();
      expect(withdrawn).not.toHaveBeenCalled();
    }
  );
}
