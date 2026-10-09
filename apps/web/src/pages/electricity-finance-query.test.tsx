import { QueryComponentProvider } from '../test/query-provider.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import Increases from './AdminElectricityIncreasesPage.js';
import Prices from './AdminElectricityPriceAdjustmentsPage.js';
import { increaseDecisionFixture } from '../test/electricity-increase-decision-fixtures.js';
import { staffPriceState } from '../test/electricity-price-staff-fixtures.js';
import {
  priceContractId,
  priceAdjustmentRow,
} from '../test/electricity-price-adjustment-fixtures.js';
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ status: 'ready', timezone: 'UTC', format: String, notice: null }),
}));
vi.mock('../components/OrderWalletBalance.js', () => ({ OrderWalletBalance: () => null }));
let root: Root,
  host: HTMLDivElement,
  kind: string,
  first: boolean,
  signal: AbortSignal,
  finish: (value: unknown) => void;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  window.history.replaceState(
    null,
    '',
    `/admin/electricity-price-adjustments?contractId=${priceContractId}`
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  first = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      expect(init?.method).toBeUndefined();
      expect(init?.body).toBeUndefined();
      expect(init?.credentials).toBe('include');
      expect(path).toContain(
        kind === 'increase'
          ? '/api/staff/electricity/increase-requests?'
          : `/api/staff/electricity/contracts/${priceContractId}/price-adjustments`
      );
      if (first) {
        first = false;
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
      return Response.json(
        kind === 'increase' ? { requests: [], nextBefore: null } : staffPriceState()
      );
    })
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});
async function render(present = true, actor = 'staff-one') {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        <AccountUserProvider value={actor}>
          {present ? kind === 'increase' ? <Increases /> : <Prices /> : null}
        </AccountUserProvider>
      </QueryComponentProvider>
    )
  );
}
for (const name of ['increase', 'price'])
  it.each(['unmount', 'actor', 'profile-context'])(
    'owns pending ' + name + ' read bytes on %s without obsolete work or a command',
    async (change) => {
      kind = name;
      await render();
      expect(first).toBe(false);
      expect(signal.aborted).toBe(false);
      const oldSignal = signal,
        oldFinish = finish;
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('online'));
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      if (change === 'unmount') await render(false);
      else if (change === 'actor') await render(true, 'staff-two');
      else await act(async () => refreshProfileContext());
      expect(oldSignal.aborted).toBe(true);
      await act(async () =>
        oldFinish(
          name === 'increase'
            ? {
                requests: [
                  { ...increaseDecisionFixture().request, contractId: 'Private obsolete' },
                ],
                nextBefore: null,
              }
            : staffPriceState([{ ...priceAdjustmentRow(), reason: 'Private obsolete' }])
        )
      );
      expect(host.textContent).not.toContain('Private obsolete');
      expect(fetch).toHaveBeenCalledTimes(change === 'unmount' ? 1 : 2);
      expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method && !init?.body)).toBe(
        true
      );
    }
  );
