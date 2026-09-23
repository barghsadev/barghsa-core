import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@barghsa/i18n/app';
import { Route } from '../routes/_app/electricity/order.js';

const notices = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast: notices }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: String, number: String }),
}));

const Page = Route.options.component as ComponentType;
const profileId = 'profile-1';
const product = {
  id: 'product-1',
  systemKey: 'thermal',
  status: 'active',
  title: { en: 'Grid electricity', fa: 'برق' },
  price: '250000',
  simpleOrderable: true,
  limits: { minKwh: '0', maxKwh: '0' },
};
const address = {
  id: 'address-1',
  profileId,
  provinceId: 'province-1',
  cityId: 'city-1',
  fullAddress: 'Existing address',
  postalCode: '1234567890',
  mainAddress: true,
};
const quote = {
  reviewDigest: 'a'.repeat(64),
  periodStart: '2026-09-26T20:30:00.000Z',
  periodEnd: '2026-10-03T20:30:00.000Z',
  durationHours: '168',
  totalKwh: '10',
  averagePowerKw: '0.05952381',
  greenRuleApplies: false,
  lines: [
    {
      productId: product.id,
      systemKey: 'thermal',
      quantityKwh: '10',
      unitPriceIrR: '250000',
      subtotalIrR: '2500000',
      discountIrR: '0',
      vatIrR: '0',
    },
  ],
  subtotalIrR: '2500000',
  discountIrR: '0',
  vatIrR: '0',
  totalIrR: '2500000',
};
const saved = { orderId: 'order-1', contractId: 'contract-1', invoiceId: 'invoice-1', ...quote };
const periods = [
  { key: 'current_month', start: '2026-09-23T00:00:00.000Z', end: '2026-09-30T20:30:00.000Z' },
  { key: 'next_month', start: '2026-09-30T20:30:00.000Z', end: '2026-10-30T20:30:00.000Z' },
  { key: 'current_week', start: '2026-09-23T00:00:00.000Z', end: '2026-09-25T20:30:00.000Z' },
  { key: 'next_week', start: '2026-09-25T20:30:00.000Z', end: '2026-10-02T20:30:00.000Z' },
  { key: 'week_after_next', start: '2026-10-02T20:30:00.000Z', end: '2026-10-09T20:30:00.000Z' },
];
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let orderReply: () => Promise<Response>;
let catalogue: unknown;

beforeEach(() => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  catalogue = [product];
  orderReply = async () => response(saved, 201);
  fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === '/api/profiles/verification-status')
      return response({
        activeProfileId: profileId,
        verificationRequired: true,
        isVerified: true,
      });
    if (url === '/api/products/electricity') return response(catalogue);
    if (url === `/api/profiles/${profileId}/addresses`) return response({ addresses: [address] });
    if (url === '/api/geography/provinces')
      return response([{ id: address.provinceId, nameFa: 'تهران', nameEn: 'Tehran' }]);
    if (url === `/api/geography/provinces/${address.provinceId}/cities`)
      return response([
        { id: address.cityId, provinceId: address.provinceId, nameFa: 'تهران', nameEn: 'Tehran' },
      ]);
    if (url === '/api/electricity/periods/simple') return response({ periods });
    if (url.startsWith(`/api/electricity/bill-data/${profileId}`))
      return response({ available: false, reason: 'unconfigured', manualEntryAllowed: true });
    if (url === '/api/electricity/preview/simple') return response(quote);
    if (url === '/api/electricity/orders/simple' && init?.method === 'POST') return orderReply();
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

const mount = () => act(async () => root.render(<Page />));
const submit = () =>
  [...container.querySelectorAll('button')].find(
    (button) => button.textContent === t('electricity.order.submit', 'en')
  )!;
const orderCalls = () =>
  fetchMock.mock.calls.filter(([url]) => url === '/api/electricity/orders/simple');
async function fill(id: string, value: string) {
  const field = container.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!;
  await act(async () => {
    const prototype =
      field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(
      new Event(field instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })
    );
  });
}
const settlePreview = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

it('shows manual entry, period dates and the server price before one submission', async () => {
  await mount();
  expect(container.textContent).toContain(t('electricity.order.manualQuantity', 'en'));
  expect(submit().disabled).toBe(true);
  await fill('electricity-period-type', 'weekly');
  await fill('electricity-period', 'next_week');
  await fill('electricity-kwh', '10');
  await settlePreview();
  expect(container.textContent).toContain('2500000');
  expect(submit().disabled).toBe(false);
  let complete!: (value: Response) => void;
  orderReply = () =>
    new Promise((resolve) => {
      complete = resolve;
    });
  await act(async () => {
    submit().click();
    submit().click();
  });
  expect(orderCalls()).toHaveLength(1);
  const sent = JSON.parse(orderCalls()[0]![1]!.body as string);
  expect(sent).toMatchObject({
    profileId,
    period: 'next_week',
    totalKwh: '10',
    expectedQuoteDigest: quote.reviewDigest,
    address: {
      provinceId: address.provinceId,
      cityId: address.cityId,
      fullAddress: address.fullAddress,
      postalCode: address.postalCode,
    },
  });
  expect(sent.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  await act(async () => complete(response(saved, 201)));
  expect(container.textContent).toContain(t('electricity.order.success.title', 'en'));
  expect(container.querySelector(`a[href="/invoices/${saved.invoiceId}"]`)).not.toBeNull();
});

it('retries a failed submission with the same idempotency key', async () => {
  await mount();
  await fill('electricity-kwh', '10');
  await settlePreview();
  orderReply = async () => {
    throw new TypeError('offline');
  };
  await act(async () => submit().click());
  const first = JSON.parse(orderCalls()[0]![1]!.body as string);
  orderReply = async () => response(saved, 201);
  await act(async () => submit().click());
  const second = JSON.parse(orderCalls()[1]![1]!.body as string);
  expect(second.idempotencyKey).toBe(first.idempotencyKey);
  expect(container.textContent).toContain(t('electricity.order.success.title', 'en'));
});

it('blocks submission when the thermal product is unavailable', async () => {
  catalogue = [{ ...product, simpleOrderable: false }];
  await mount();
  await fill('electricity-kwh', '10');
  await settlePreview();
  expect(submit().disabled).toBe(true);
  expect(orderCalls()).toHaveLength(0);
});
