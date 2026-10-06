import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ElectricityOrdersPage } from './ElectricityOrdersPage.js';
import { SavingOrdersPage } from './SavingOrdersPage.js';
import { SolarRequestsPage } from './SolarRequestsPage.js';
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
const row = (id = first) => ({
  id,
  orderId: id,
  invoiceId: id,
  contractId: id,
  status: 'submitted',
  electricityStatus: 'submitted',
  financialStatus: 'paid',
  nextAction: 'await_review',
  submittedAt: '2026-10-05T10:00:00.000Z',
  submitted_at: '2026-10-05T10:00:00.000Z',
  periodStart: '2026-10-01T00:00:00.000Z',
  periodEnd: '2026-11-01T00:00:00.000Z',
  totalKwh: '10',
  totalIrR: '9007199254740993',
  total_amount: '9007199254740993',
  plan_title: { en: 'Plan', fa: 'طرح' },
  hardware_title: { en: 'Device', fa: 'تجهیز' },
  bill_identifier: '12345678',
  financial_status: 'paid',
  invoice_id: null,
  contract_id: null,
  building_type: 'non_household',
  grid_type: 'off_grid',
});
const scenarios = [
  {
    name: 'electricity',
    Page: ElectricityOrdersPage,
    api: '/api/electricity/orders',
    key: 'orders',
  },
  { name: 'saving', Page: SavingOrdersPage, api: '/api/saving/orders', key: 'orders' },
  { name: 'solar', Page: SolarRequestsPage, api: '/api/solar/requests', key: 'requests' },
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
        expect(last.searchParams.has('before')).toBe(false);
        expect(last.searchParams.get('profileId')).toBe(profile);
      });
    }
