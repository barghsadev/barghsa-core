import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@barghsa/i18n/app';
import { AdvancedElectricityOrderPage } from './AdvancedElectricityOrderPage.js';

const blockerConfig = vi.hoisted(() => ({
  current: null as null | {
    shouldBlockFn: (locations: {
      current: { pathname: string };
      next: { pathname: string };
    }) => boolean;
    enableBeforeUnload: () => boolean;
  },
}));
const navigateMock = vi.hoisted(() => vi.fn(async (_options: unknown) => {}));
const wizardNavigate = async (options: {
  to: string;
  search?: { step?: number };
  params?: unknown;
  replace?: boolean;
}) => {
  if (options.to === '/electricity/advanced') {
    window.history[options.replace ? 'replaceState' : 'pushState'](
      {},
      '',
      `${options.to}?step=${options.search?.step}`
    );
  } else await navigateMock(options);
};
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => wizardNavigate,
  useBlocker: (options: NonNullable<typeof blockerConfig.current>) => {
    blockerConfig.current = options;
    return { status: 'idle' };
  },
  useSearch: ({ select }: { select: (search: { step?: number }) => unknown }) => {
    const step = new URLSearchParams(window.location.search).get('step');
    return select(step === null ? {} : { step: Number(step) });
  },
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: String, number: String, irrDigits: String }),
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
let bootstrapLoadFailures: number;
let draftLoadFailures: number;
let draftReply: (input: object) => Promise<Response>;
let orderReply: (() => Promise<Response>) | null;
let savedStepOverride: number | null;
let quoteSuccess: boolean;
let contractTemplate: { name: string; versionNumber: number; text: string } | null;
let orderConflict: boolean;
let giftCode: string;
let addresses: Array<{
  id: string;
  provinceId: string;
  cityId: string;
  fullAddress: string;
  postalCode: string;
  mainAddress: boolean;
}>;
let quoteErrorDetails: Array<{
  code: string;
  systemKey?: string;
  requiredKwh?: string;
  limitKwh?: string;
}>;

beforeEach(() => {
  window.history.replaceState({}, '', '/electricity/advanced');
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  navigateMock.mockReset();
  step = 2;
  quantities = { thermal: '0', green: '10', free_market: '0', energy_saving: '0' };
  bootstrapLoadFailures = 0;
  draftLoadFailures = 0;
  savedStepOverride = null;
  draftReply = async (input) => reply(input);
  orderReply = null;
  quoteSuccess = false;
  contractTemplate = null;
  orderConflict = false;
  giftCode = '';
  addresses = [];
  quoteErrorDetails = [
    { code: 'PRODUCT_MAX_KWH', systemKey: 'green', requiredKwh: '5', limitKwh: '4' },
  ];
  const startAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const endAt = new Date(Date.now() + 10 * 86_400_000).toISOString();
  fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === '/api/profiles/verification-status')
      return reply({ activeProfileId: profileId, verificationRequired: true, isVerified: true });
    if (url === '/api/products/electricity') {
      if (bootstrapLoadFailures > 0) {
        bootstrapLoadFailures -= 1;
        return reply({ error: 'Unavailable' }, 503);
      }
      return reply(catalogue);
    }
    if (url === '/api/electricity/periods/advanced')
      return reply({
        limits: { leadTimeDays: 0, maxContractDuration: 24 },
        mandatoryGreenEnabled: true,
      });
    if (url === `/api/profiles/${profileId}/addresses`) return reply({ addresses });
    if (url === `/api/electricity/drafts/advanced?profileId=${profileId}`) {
      if (draftLoadFailures > 0) {
        draftLoadFailures -= 1;
        return reply({ error: 'Unavailable' }, 503);
      }
      return reply({ currentStep: step, data: { startAt, endAt, quantities, giftCode } });
    }
    if (url === '/api/electricity/drafts/advanced') {
      const saved = JSON.parse((init?.body as string) ?? '{}') as {
        currentStep: number;
      };
      return draftReply({ ...saved, currentStep: savedStepOverride ?? saved.currentStep });
    }
    if (url === '/api/electricity/preview/advanced')
      return quoteSuccess
        ? reply({
            reviewDigest: 'review-1',
            contractTemplate,
            periodStart: startAt,
            periodEnd: endAt,
            durationHours: '192',
            totalKwh: '100',
            averagePowerKw: '0.52',
            greenRuleApplies: false,
            mandatoryGreenEnabled: true,
            walletBalanceIrR: '1000',
            lines: [
              {
                systemKey: 'thermal',
                quantityKwh: '100',
                unitPriceIrR: '100',
                subtotalIrR: '10000',
                discountIrR: '1000',
                vatIrR: '900',
                totalIrR: '9900',
              },
            ],
            subtotalIrR: '10000',
            discountIrR: '1000',
            vatIrR: '900',
            totalIrR: '9900',
          })
        : reply(
            {
              error: 'ELECTRICITY_QUOTE_INVALID',
              details: quoteErrorDetails,
            },
            400
          );
    if (url === '/api/electricity/orders/advanced' && init?.method === 'POST')
      return orderReply
        ? orderReply()
        : orderConflict
          ? reply({ message: 'Changed' }, 409)
          : reply(
              {
                orderId: '11111111-1111-4111-8111-111111111111',
                contractId: '22222222-2222-4222-8222-222222222222',
                invoiceId: '33333333-3333-4333-8333-333333333333',
              },
              201
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

it('shows a support path when required electricity supply is unavailable', async () => {
  step = 3;
  quantities = { thermal: '100', green: '0', free_market: '0', energy_saving: '0' };
  quoteErrorDetails = [{ code: 'PRODUCT_UNAVAILABLE', systemKey: 'thermal' }];
  await mount();
  await settlePreview();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    'Ordering this product is temporarily unavailable.'
  );
  expect(container.querySelector('a[href="/support"]')?.textContent).toBe('Contact support');
});

it('keeps an unavailable draft closed until a retry restores the saved step', async () => {
  draftLoadFailures = 1;
  await mount();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    t('electricity.order.draftLoadFailed', 'en')
  );
  expect(container.querySelector('nav')).toBeNull();

  const retry = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === t('electricity.order.retry', 'en')
  );
  await act(async () => retry?.click());
  expect(container.querySelector('li[aria-current="step"]')?.textContent).toContain(
    t('electricity.advanced.stepProducts', 'en')
  );
});

it('retries initial order context before opening the wizard', async () => {
  bootstrapLoadFailures = 1;
  await mount();
  expect(container.querySelector('nav')).toBeNull();
  const retry = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === t('electricity.order.retry', 'en')
  );
  await act(async () => retry?.click());
  expect(container.querySelector('li[aria-current="step"]')?.textContent).toContain(
    t('electricity.advanced.stepProducts', 'en')
  );
});

it('does not advance until the server confirms the saved step', async () => {
  step = 1;
  quantities = { thermal: '0', green: '0', free_market: '0', energy_saving: '0' };
  savedStepOverride = 1;
  await mount();

  const next = () =>
    [...container.querySelectorAll('button')].find(
      (button) => button.textContent === t('electricity.order.next', 'en')
    );
  await act(async () => next()?.click());
  expect(container.querySelector('li[aria-current="step"]')?.textContent).toContain(
    t('electricity.advanced.stepDates', 'en')
  );
  expect(fetchMock.mock.calls.some(([url]) => url === '/api/electricity/drafts/advanced')).toBe(
    true
  );

  savedStepOverride = null;
  await act(async () => next()?.click());
  expect(container.querySelector('li[aria-current="step"]')?.textContent).toContain(
    t('electricity.advanced.stepProducts', 'en')
  );
});

it('saves the address step before opening address settings', async () => {
  step = 4;
  savedStepOverride = 3;
  await mount();

  const gift = [...container.querySelectorAll('label')]
    .find((label) => label.textContent?.includes(t('electricity.order.giftCode', 'en')))!
    .querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(gift, 'POWER');
    gift.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const locations = {
    current: { pathname: '/electricity/advanced' },
    next: { pathname: '/settings/addresses' },
  };
  expect(blockerConfig.current!.shouldBlockFn(locations)).toBe(true);
  navigateMock.mockImplementation(async () => {
    expect(blockerConfig.current!.shouldBlockFn(locations)).toBe(false);
    expect(blockerConfig.current!.enableBeforeUnload()).toBe(false);
  });
  const addAddress = () =>
    [...container.querySelectorAll('button')].find(
      (button) => button.textContent === t('electricity.order.addAddress', 'en')
    );
  await act(async () => addAddress()?.click());
  expect(navigateMock).not.toHaveBeenCalled();

  savedStepOverride = null;
  await act(async () => addAddress()?.click());
  expect(navigateMock).toHaveBeenCalledWith({
    to: '/settings/addresses',
    search: { returnTo: '/electricity/advanced' },
  });
});

it.each(['en', 'fa'] as const)(
  'shows the selected profile, address, gift code and cancellation terms before submission in %s',
  async (locale) => {
    document.documentElement.lang = locale;
    step = 5;
    quantities = { thermal: '100', green: '0', free_market: '0', energy_saving: '0' };
    quoteSuccess = true;
    giftCode = 'SAVE10';
    addresses = [
      {
        id: 'address-1',
        provinceId: 'province-1',
        cityId: 'city-1',
        fullAddress: 'Example Street 4',
        postalCode: '1234567890',
        mainAddress: true,
      },
    ];
    await mount();
    await settlePreview();

    expect(container.querySelector('[data-review-section=profile] dd')?.textContent).toBe(
      profileId
    );
    expect(
      container.querySelectorAll('[data-review-section] input, [data-review-section] select')
    ).toHaveLength(0);
    expect(container.textContent).toContain('SAVE10');
    expect(container.textContent).toContain('Example Street 4');
    expect(container.textContent).toContain('1234567890');
    expect(container.textContent).toContain(t('electricity.order.cancellationRules', locale));
    expect(container.textContent).toContain(t('electricity.order.cancellationRulesText', locale));
    expect(container.textContent).toContain(t('electricity.order.paymentAfterSubmit', locale));
  }
);

it('refreshes the advanced contract terms after a submission conflict', async () => {
  step = 5;
  quantities = { thermal: '100', green: '0', free_market: '0', energy_saving: '0' };
  quoteSuccess = true;
  orderConflict = true;
  contractTemplate = { name: 'Electricity agreement', versionNumber: 1, text: 'Original terms' };
  addresses = [
    {
      id: 'address-1',
      provinceId: 'province-1',
      cityId: 'city-1',
      fullAddress: 'Example Street 4',
      postalCode: '1234567890',
      mainAddress: true,
    },
  ];
  await mount();
  await settlePreview();
  expect(container.textContent).toContain('Original terms');
  expect(
    container.querySelector(`[aria-label="${t('electricity.order.total', 'en')}"]`)
  ).not.toBeNull();
  contractTemplate = { name: 'Electricity agreement', versionNumber: 2, text: 'Updated terms' };
  const submit = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === t('electricity.order.submit', 'en')
  );
  await act(async () => submit?.click());
  await settlePreview();
  expect(container.textContent).toContain('Updated terms');
  expect(container.textContent).not.toContain('Original terms');
  expect(navigateMock).not.toHaveBeenCalled();
  expect(
    fetchMock.mock.calls.filter(([url]) => url === '/api/electricity/preview/advanced')
  ).toHaveLength(2);
});

it('does not advance when the saved bundle differs from the reviewed quantities', async () => {
  step = 2;
  quantities = { thermal: '100', green: '0', free_market: '0', energy_saving: '0' };
  quoteSuccess = true;
  draftReply = async (input) => reply({ ...input, data: { quantities: { thermal: '101' } } });
  await mount();
  await settlePreview();
  const next = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === t('electricity.order.next', 'en')
  )!;
  await act(async () => next.click());
  expect(window.location.search).toBe('?step=2');
  expect(container.querySelector<HTMLInputElement>('#advanced-thermal')?.value).toBe('100');
});

it('sends one submission and retains its key until all order references are confirmed', async () => {
  step = 5;
  quantities = { thermal: '100', green: '0', free_market: '0', energy_saving: '0' };
  quoteSuccess = true;
  addresses = [
    {
      id: 'address-1',
      provinceId: 'province-1',
      cityId: 'city-1',
      fullAddress: 'Example Street',
      postalCode: '1234567890',
      mainAddress: true,
    },
  ];
  let finish!: (value: Response) => void;
  orderReply = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  await mount();
  await settlePreview();
  const submit = () =>
    [...container.querySelectorAll('button')].find(
      (button) => button.textContent === t('electricity.order.submit', 'en')
    )!;
  await act(async () => {
    submit().click();
    submit().click();
  });
  const orderCalls = () =>
    fetchMock.mock.calls.filter(([url]) => url === '/api/electricity/orders/advanced');
  expect(orderCalls()).toHaveLength(1);
  expect(container.querySelector('fieldset')?.disabled).toBe(true);
  await act(async () => finish(reply({ orderId: '11111111-1111-4111-8111-111111111111' }, 201)));
  expect(navigateMock).not.toHaveBeenCalled();
  expect(submit().disabled).toBe(false);
  orderReply = null;
  await act(async () => submit().click());
  expect(JSON.parse(orderCalls()[1]![1]!.body as string).idempotencyKey).toBe(
    JSON.parse(orderCalls()[0]![1]!.body as string).idempotencyKey
  );
  expect(navigateMock).toHaveBeenCalledWith({
    to: '/electricity/orders/$orderId',
    params: { orderId: '11111111-1111-4111-8111-111111111111' },
  });
});

it('ignores an order receipt after the advanced form has unmounted', async () => {
  step = 5;
  quantities = { thermal: '100', green: '0', free_market: '0', energy_saving: '0' };
  quoteSuccess = true;
  addresses = [
    {
      id: 'address-1',
      provinceId: 'province-1',
      cityId: 'city-1',
      fullAddress: 'Example Street',
      postalCode: '1234567890',
      mainAddress: true,
    },
  ];
  let finish!: (value: Response) => void;
  orderReply = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  await mount();
  await settlePreview();
  const submit = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === t('electricity.order.submit', 'en')
  )!;
  await act(async () => submit.click());
  await act(async () => root.render(null));
  await act(async () =>
    finish(
      reply(
        {
          orderId: '11111111-1111-4111-8111-111111111111',
          contractId: '22222222-2222-4222-8222-222222222222',
          invoiceId: '33333333-3333-4333-8333-333333333333',
        },
        201
      )
    )
  );
  expect(navigateMock).not.toHaveBeenCalled();
});
