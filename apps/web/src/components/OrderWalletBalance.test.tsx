import { QueryProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { OrderWalletBalance } from './OrderWalletBalance.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';

vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: String }),
}));
let clean: (() => Promise<void>) | undefined;
afterEach(async () => {
  await clean?.();
  clean = undefined;
  vi.unstubAllGlobals();
});
const profile = '86000000-0000-4000-8000-000000000001';
const other = '86000000-0000-4000-8000-000000000002';
function response(balance: string, profileId = profile) {
  return new Response(JSON.stringify({ balance, profileId, currency: 'IRR' }));
}
async function mount(props: Parameters<typeof OrderWalletBalance>[0], actor = 'first') {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = async (next = props, who = actor) => {
    await act(async () =>
      root.render(
        <QueryProvider>
          <AccountUserProvider value={who}>
            <OrderWalletBalance {...next} />
          </AccountUserProvider>
        </QueryProvider>
      )
    );
  };
  clean = async () => {
    await act(async () => root.unmount());
    container.remove();
  };
  await render();
  return { container, render };
}

it('displays available balance and exact remaining shortfall with the customer funding return link', async () => {
  const fetcher = vi.fn().mockResolvedValue(response('30'));
  vi.stubGlobal('fetch', fetcher);
  const { container } = await mount({
    profileId: profile,
    total: '100',
    paid: '20',
    invoiceId: other,
  });
  await vi.waitFor(() => expect(container.textContent).toContain('Available wallet balance: 30'));
  expect(container.textContent).toContain('Wallet top-up needed: 50');
  expect(container.querySelector('a')?.getAttribute('href')).toBe(
    `/wallet?returnInvoiceId=${other}`
  );
  expect(fetcher).toHaveBeenCalledWith(
    `/api/wallet/${profile}`,
    expect.objectContaining({ cache: 'no-store', credentials: 'include' })
  );
});
it('uses the staff endpoint and customer funding instructions without linking the staff personal wallet', async () => {
  const fetcher = vi.fn().mockResolvedValue(response('30'));
  vi.stubGlobal('fetch', fetcher);
  const { container } = await mount({ profileId: profile, total: '100', paid: '20', staff: true });
  await vi.waitFor(() => expect(container.textContent).toContain('Available wallet balance: 30'));
  expect(container.textContent).toContain('Wallet top-up needed: 50');
  expect(container.textContent).toContain('The customer can fund this profile wallet online');
  expect(container.querySelector('a')).toBeNull();
  expect(fetcher.mock.calls[0]?.[0]).toBe(`/api/staff/profiles/${profile}/wallet-balance`);
});
it('keeps IRR arithmetic exact above the JavaScript safe integer range', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('9007199254740993')));
  const { container } = await mount({ profileId: profile, total: '9007199254740994' });
  await vi.waitFor(() => expect(container.textContent).toContain('9007199254740993'));
  expect(container.textContent).toContain('Wallet top-up needed: 1');
});
it('withdraws old actor/profile data immediately and ignores late earlier responses', async () => {
  const pending: Array<(value: Response) => void> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() => new Promise<Response>((resolve) => pending.push(resolve)))
  );
  const { container, render } = await mount({ profileId: profile, total: '1000' });
  await render({ profileId: other, total: '1000' });
  await act(async () => pending[1]!(response('202', other)));
  expect(container.textContent).toContain('Available wallet balance: 202');
  await act(async () => pending[0]!(response('101')));
  expect(container.textContent).not.toContain('101');
  await render({ profileId: other, total: '1000' }, 'second');
  expect(container.textContent).not.toContain('202');
  await act(async () => pending[2]!(new Response('{}', { status: 403 })));
  expect(container.textContent).toContain(
    'Current access does not allow viewing this wallet balance.'
  );
  expect(container.querySelector('a')).toBeNull();
});
it.each([{}, { balance: 10, currency: 'IRR' }, { balance: '99', currency: 'USD' }])(
  'never treats a malformed balance as zero: %j',
  async (value) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(value))));
    const { container } = await mount({ profileId: profile });
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Wallet balance is unavailable.')
    );
    expect(container.textContent).not.toContain('Available wallet balance: 0');
  }
);
it('does not request funding for free or already-paid intake and can refresh a displayed balance', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response('0'))
    .mockResolvedValueOnce(response('50'));
  vi.stubGlobal('fetch', fetcher);
  const { container } = await mount({ profileId: profile, total: '100', paid: '100' });
  await vi.waitFor(() => expect(container.textContent).toContain('Available wallet balance: 0'));
  expect(container.querySelector('a')).toBeNull();
  await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
  await vi.waitFor(() => expect(container.textContent).toContain('Available wallet balance: 50'));
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('refuses a staff balance response for another profile', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('99', other)));
  const { container } = await mount({ profileId: profile, total: '100', staff: true });
  await vi.waitFor(() => expect(container.textContent).toContain('Wallet balance is unavailable.'));
  expect(container.textContent).not.toContain('Available wallet balance: 99');
  expect(container.textContent).not.toContain('Wallet top-up needed: 1');
});
it.each([
  { total: 'private-invalid', paid: '0' },
  { total: '100', paid: 'private-invalid' },
])('does not invent a funding amount from invalid reviewed money: %j', async (money) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('0')));
  const { container } = await mount({ profileId: profile, ...money });
  await vi.waitFor(() => expect(container.textContent).toContain('Available wallet balance: 0'));
  expect(container.querySelector('a')).toBeNull();
  expect(container.textContent).not.toContain('Wallet top-up needed:');
  expect(container.textContent).not.toContain('private-invalid');
});
it('keeps balance refresh manual and hides an earlier amount while the explicit refresh is pending', async () => {
  let finish!: (value: Response) => void;
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response('100'))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        })
    );
  vi.stubGlobal('fetch', fetcher);
  const { container } = await mount({ profileId: profile });
  expect(container.textContent).toContain('Available wallet balance: 100');
  window.dispatchEvent(new Event('focus'));
  window.dispatchEvent(new Event('online'));
  await act(async () => {});
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
  expect(container.textContent).not.toContain('100');
  expect(container.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
  await act(async () => finish(response('200')));
  expect(container.textContent).toContain('Available wallet balance: 200');
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('a reviewed scope change cancels the discarded read and returns to a scope with a fresh balance', async () => {
  let old!: (value: Response) => void;
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response('100'))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          old = resolve;
        })
    )
    .mockResolvedValueOnce(response('300'));
  vi.stubGlobal('fetch', fetcher);
  const { container, render } = await mount({ profileId: profile, scopeKey: 'review-a' });
  expect(container.textContent).toContain('Available wallet balance: 100');
  await render({ profileId: profile, scopeKey: 'review-b' });
  const signal = fetcher.mock.calls[1]![1].signal as AbortSignal;
  expect(container.textContent).not.toContain('100');
  await render({ profileId: profile, scopeKey: 'review-a' });
  expect(signal.aborted).toBe(true);
  expect(container.textContent).toContain('Available wallet balance: 300');
  await act(async () => old(new Response('{}', { status: 403 })));
  expect(container.textContent).toContain('Available wallet balance: 300');
  expect(container.textContent).not.toContain('Current access does not allow');
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it('makes no wallet request or funding offer while the profile owner is unresolved', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const { container } = await mount({ profileId: '', total: '100' });
  expect(fetcher).not.toHaveBeenCalled();
  expect(container.querySelector('a')).toBeNull();
  expect(container.textContent).not.toContain('Wallet top-up needed:');
  expect(container.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
});
