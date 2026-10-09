import { QueryComponentProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { SavingsOrderPage } from './SavingsOrderPage.js';
import { t } from '@barghsa/i18n/workspace';

const wizard = vi.hoisted(() => ({ step: 6, go: vi.fn(), restore: vi.fn(), reset: vi.fn() }));
vi.mock('../hooks/useWizardStep.js', () => ({ useWizardStep: () => wizard }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useBlocker: () => ({ status: 'idle' }),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: (value: string) => `${value} IRR`, number: String }),
}));
let root: Root, host: HTMLDivElement;
let payload: unknown;
let finish: ((value: unknown) => void) | undefined;
let signal: AbortSignal;
let pending: boolean;
const agreement = { versionId: 'agreement-1', title: 'Terms', body: 'Agreement body' };
const address = {
  id: 'address-1',
  provinceId: 'province-1',
  cityId: 'city-1',
  fullAddress: 'Site',
  postalCode: '1234567890',
  mainAddress: true,
};
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  pending = false;
  finish = undefined;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/profiles')
        return Response.json({
          activeProfileId: 'profile-1',
          profiles: [{ id: 'profile-1', profileType: 'INDIVIDUAL' }],
        });
      if (url === '/api/saving/plans')
        return Response.json({
          plans: [
            {
              id: 'plan-1',
              title: { fa: 'طرح', en: 'Plan' },
              price: '100000',
              description: null,
              status: 'active',
              available: true,
              hardware: [
                {
                  id: 'device-1',
                  title: { fa: 'دستگاه', en: 'Device' },
                  price: '200000',
                  status: 'active',
                  description: null,
                },
              ],
              agreement,
            },
          ],
        });
      if (url === '/api/profiles/profile-1/addresses')
        return Response.json({ addresses: [address] });
      if (url.startsWith('/api/saving/orders/draft?'))
        return Response.json({
          currentStep: 2,
          data: {
            planId: 'plan-1',
            hardwareId: 'device-1',
            billIdentifier: '12345678',
            addressId: 'address-1',
            giftCode: '',
          },
          updatedAt: '2026-01-01T00:00:00Z',
        });
      if (url === '/api/saving/orders/quote')
        return Response.json({
          reviewDigest: 'a'.repeat(64),
          plan: { id: 'plan-1', title: { fa: 'طرح', en: 'Plan' } },
          hardware: { id: 'device-1', title: { fa: 'دستگاه', en: 'Device' } },
          billIdentifier: '12345678',
          address: {
            id: address.id,
            province_id: address.provinceId,
            city_id: address.cityId,
            full_address: address.fullAddress,
            postal_code: address.postalCode,
          },
          agreement,
          lines: [],
          subtotalIrR: '300000',
          discountIrR: '0',
          vatIrR: '0',
          totalIrR: '300000',
        });
      if (url === '/api/wallet/profile-1') {
        signal = init!.signal as AbortSignal;
        return {
          ok: true,
          status: 200,
          json: () =>
            pending
              ? new Promise((resolve) => {
                  finish = resolve;
                })
              : Promise.resolve(payload),
        };
      }
      throw new Error(`Unexpected ${url}`);
    })
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});
async function mount() {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        <SavingsOrderPage />
      </QueryComponentProvider>
    )
  );
}
function submissionCalls() {
  return vi
    .mocked(fetch)
    .mock.calls.filter(
      ([url, init]) => String(url) === '/api/saving/orders' && init?.method === 'POST'
    );
}
it.each([
  [{ availableBalance: 9007199254740992, balance: '500000' }, null],
  [{ balance: 9007199254740992 }, null],
  [{ availableBalance: '9007199254740993123456' }, '9007199254740993123456'],
  [{ balance: '9007199254740993123456' }, '9007199254740993123456'],
] as const)('requires an exact decimal funding balance: %j', async (body, expected) => {
  payload = body;
  await mount();
  expect(host.textContent).toContain(expected ?? t('wallet.funding.unknown', 'en'));
  expect(submissionCalls()).toHaveLength(0);
});
it('cancels funding response bytes on page-only unmount and does not refetch on focus', async () => {
  pending = true;
  await mount();
  expect(finish).toBeDefined();
  expect(signal.aborted).toBe(false);
  const count = vi
    .mocked(fetch)
    .mock.calls.filter(([url]) => String(url) === '/api/wallet/profile-1').length;
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
  });
  expect(
    vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === '/api/wallet/profile-1')
  ).toHaveLength(count);
  await act(async () => root.render(<QueryComponentProvider>{null}</QueryComponentProvider>));
  expect(signal.aborted).toBe(true);
  await act(async () => finish!({ availableBalance: '9007199254740993123456' }));
  expect(host.textContent).toBe('');
  expect(submissionCalls()).toHaveLength(0);
});
