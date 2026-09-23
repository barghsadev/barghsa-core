import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@barghsa/i18n/app';
import { AdvancedElectricityOrderPage } from './AdvancedElectricityOrderPage.js';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => vi.fn(async () => {}),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: String, irrDigits: String }),
}));

const profileId = 'profile-1';
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const catalogue = (['thermal', 'green', 'free_market', 'energy_saving'] as const).map(
  (systemKey) => ({
    id: systemKey,
    systemKey,
    title: { en: systemKey },
    price: '100',
    status: 'active',
    orderable: true,
    limits: { minKwh: '0', maxKwh: '0' },
  })
);

let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let step: number;
let quantities: Record<string, string>;

beforeEach(() => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  step = 2;
  quantities = { thermal: '0', green: '10', free_market: '0', energy_saving: '0' };
  const startAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const endAt = new Date(Date.now() + 10 * 86_400_000).toISOString();
  fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url === '/api/profiles/verification-status')
      return reply({ activeProfileId: profileId, verificationRequired: true, isVerified: true });
    if (url === '/api/products/electricity') return reply(catalogue);
    if (url === '/api/electricity/periods/advanced')
      return reply({
        limits: { leadTimeDays: 0, maxContractDuration: 24 },
        mandatoryGreenEnabled: true,
      });
    if (url === `/api/profiles/${profileId}/addresses`) return reply({ addresses: [] });
    if (url === `/api/electricity/drafts/advanced?profileId=${profileId}`)
      return reply({ currentStep: step, data: { startAt, endAt, quantities } });
    if (url === '/api/electricity/preview/advanced')
      return reply(
        {
          error: 'ELECTRICITY_QUOTE_INVALID',
          details: [
            { code: 'PRODUCT_MAX_KWH', systemKey: 'green', requiredKwh: '5', limitKwh: '4' },
          ],
        },
        400
      );
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const mount = () => act(async () => root.render(<AdvancedElectricityOrderPage />));
const settlePreview = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
  });

it('ignores a restored manual green amount when the mandatory rule locks green', async () => {
  await mount();
  await settlePreview();
  expect(container.querySelector<HTMLInputElement>('#advanced-green')?.value).toBe('0');
  expect(container.querySelector<HTMLInputElement>('#advanced-green')?.disabled).toBe(true);
  expect(fetchMock.mock.calls.some(([url]) => url === '/api/electricity/preview/advanced')).toBe(
    false
  );
  expect(
    [...container.querySelectorAll('button')].find(
      (button) => button.textContent === t('electricity.order.next', 'en')
    )?.disabled
  ).toBe(true);
});

it('shows a quote conflict without a permanent loading message', async () => {
  step = 3;
  quantities = { thermal: '100', green: '0', free_market: '0', energy_saving: '0' };
  await mount();
  await settlePreview();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    'requires 5 kWh of Green electricity, but the product maximum is 4 kWh'
  );
  expect(container.textContent).not.toContain('Calculating price');
});
