import { QueryComponentProvider } from '../test/query-provider.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { WalletPage } from './WalletPage.js';
import type { OnlineTopUpReview } from '@barghsa/shared/finance';
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ status: 'ready', notice: null, format: String }),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({
    money: String,
    number: String,
    percent: String,
    irrDigits: String,
    tomanDigits: String,
  }),
}));
vi.mock('../components/OnlineTopUpReviewDialog.js', () => ({
  default: ({ review }: { review: OnlineTopUpReview }) => (
    <div role="dialog">{review.data.amountIrR}</div>
  ),
}));
const profile = '11111111-1111-4111-8111-111111111111';
function review(amount = '10000') {
  return {
    schemaVersion: 1,
    scope: { action: 'wallet.online-topup-initiation', profileId: profile, resourceId: profile },
    data: {
      profileId: profile,
      amountIrR: amount,
      onlineTopUpLimitIrR: '2000000',
      configVersion: 1,
      paymentSource: 'external_gateway',
      stateAfterInitiation: 'Pending',
      creditRule: 'after_verified_gateway_payment',
    },
    hash: 'a'.repeat(64),
  };
}
let host: HTMLDivElement,
  root: Root,
  signal: AbortSignal,
  finish: (value: unknown) => void,
  first: boolean;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.cookie = 'barghsa_csrf=review-live; path=/';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  first = true;
  signal = undefined as unknown as AbortSignal;
  finish = undefined as unknown as (value: unknown) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (init?.method === 'POST') {
        expect(path).toBe('/api/wallet/' + profile + '/top-ups/review');
        expect(init.credentials).toBe('include');
        expect(new Headers(init.headers).get('x-csrf-token')).toBe('review-live');
        expect(JSON.parse(String(init.body))).toMatchObject({
          amount: 10000,
          idempotencyKey: expect.any(String),
        });
        if (first) {
          first = false;
          signal = init.signal as AbortSignal;
          return {
            ok: true,
            status: 200,
            json: () =>
              new Promise((resolve) => {
                finish = resolve;
              }),
          } as Response;
        }
        return Response.json(review());
      }
      expect(init?.body).toBeUndefined();
      if (path === '/api/profiles') return Response.json({ activeProfileId: profile });
      if (path === '/api/wallet/' + profile)
        return Response.json({
          balance: '100000',
          currency: 'IRR',
          onlineTopUpLimit: 2000000,
          configVersion: 1,
        });
      if (path.startsWith('/api/wallet/' + profile + '/transactions'))
        return Response.json({ transactions: [], nextCursor: null });
      expect(path).toBe('/api/maintenance');
      return Response.json({ capabilities: [] });
    })
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.cookie = 'barghsa_csrf=; Max-Age=0; path=/';
  host.remove();
  vi.unstubAllGlobals();
});
async function render(present = true, actor = 'account-one') {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        <AccountUserProvider value={actor}>{present && <WalletPage />}</AccountUserProvider>
      </QueryComponentProvider>
    )
  );
}
async function prepare() {
  await vi.waitFor(() =>
    expect(host.querySelector<HTMLInputElement>('#top-up-amount')?.disabled).toBe(false)
  );
  const input = host.querySelector<HTMLInputElement>('#top-up-amount')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '10000');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const button = host.querySelector<HTMLButtonElement>('[data-testid="wallet-submit"]')!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
}
it.each(['unmount', 'actor', 'profile-context'])(
  'cancels actual online top-up review JSON on %s without starting payment',
  async (change) => {
    await render();
    await prepare();
    await vi.waitFor(() => expect(finish).toBeDefined());
    const oldSignal = signal,
      oldFinish = finish;
    expect(oldSignal.aborted).toBe(false);
    const count = vi.mocked(fetch).mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
    });
    expect(fetch).toHaveBeenCalledTimes(count);
    if (change === 'unmount') await render(false);
    else if (change === 'actor') await render(true, 'account-two');
    else await act(async () => refreshProfileContext());
    expect(oldSignal.aborted).toBe(true);
    await act(async () => oldFinish(review()));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    if (change !== 'unmount') {
      await prepare();
      await vi.waitFor(() =>
        expect(host.querySelector('[role="dialog"]')?.textContent).toBe('10000')
      );
    }
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(([, init]) => init?.method === 'POST')
        .every(([p]) => String(p).endsWith('/review'))
    ).toBe(true);
  }
);
