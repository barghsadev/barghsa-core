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
  useNumberFormatting: () => ({ money: String }),
}));
const OrderPage = Route.options.component as ComponentType;
const profileId = 'profile-1';
const product = {
  id: 'product-1',
  type: 'electricity',
  status: 'active',
  title: { en: 'Grid electricity', fa: 'برق' },
  price: '250000',
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
const savedOrder = {
  id: 'order-1',
  profileId,
  productId: product.id,
  orderType: 'electricity',
  status: 'DRAFT',
  snapshotProvinceId: address.provinceId,
  snapshotCityId: address.cityId,
  snapshotFullAddress: address.fullAddress,
  snapshotPostalCode: address.postalCode,
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let container: HTMLDivElement;
let root: Root;
let previousLanguage: string;
let replies: Map<string, unknown>;
let orderReply: () => Promise<Response>;
let addressReply: (input: Record<string, unknown>) => Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  previousLanguage = document.documentElement.lang;
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  replies = new Map<string, unknown>([
    [
      '/api/profiles/verification-status',
      { activeProfileId: profileId, verificationRequired: true, isVerified: true },
    ],
    ['/api/products', [product]],
    [`/api/profiles/${profileId}/addresses`, { addresses: [address] }],
    ['/api/geography/provinces', [{ id: address.provinceId, nameFa: 'تهران', nameEn: 'Tehran' }]],
    [
      `/api/geography/provinces/${address.provinceId}/cities`,
      [{ id: address.cityId, provinceId: address.provinceId, nameFa: 'تهران', nameEn: 'Tehran' }],
    ],
  ]);
  orderReply = async () => response(savedOrder);
  addressReply = async (input) =>
    response({ ...input, id: 'new-address', profileId, mainAddress: false });
  fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === '/api/orders' && init?.method === 'POST') return orderReply();
    if (url === `/api/profiles/${profileId}/addresses` && init?.method === 'POST')
      return addressReply(JSON.parse(init.body as string));
    if (!replies.has(url)) throw new Error(`Unexpected request: ${url}`);
    const body = replies.get(url);
    return body instanceof Response ? body.clone() : response(body);
  });
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.documentElement.lang = previousLanguage;
  vi.unstubAllGlobals();
});
const mount = () => act(async () => root.render(<OrderPage />));
function submit() {
  const button = [...container.querySelectorAll('button')].find(
    (b) => b.textContent === t('electricity.order.submit', 'en')
  );
  expect(button).toBeDefined();
  return button!;
}
const orderCalls = () => fetchMock.mock.calls.filter(([url]) => url === '/api/orders');

async function clickText(key: string) {
  const button = [...container.querySelectorAll('button')].find(
    (b) => b.textContent === t(key, 'en')
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
async function fill(id: string, value: string) {
  const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    `#${id}`
  )!;
  expect(field).not.toBeNull();
  const prototype =
    field instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(
      new Event(field instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })
    );
  });
}
async function openAddress() {
  await clickText('electricity.order.addNewAddress');
  await fill('order-address-province', address.provinceId);
  await fill('order-address-city', address.cityId);
  await fill('order-address-fullAddress', '  New delivery address  ');
  await fill('order-address-postalCode', '2345678901');
}

it('submits the selected server product and address once while a request is pending', async () => {
  let complete!: (response: Response) => void;
  orderReply = () =>
    new Promise((resolve) => {
      complete = resolve;
    });
  await mount();
  const button = submit();
  expect(button.disabled).toBe(false);
  await act(async () => {
    button.click();
    button.click();
  });
  expect(orderCalls()).toHaveLength(1);
  expect(JSON.parse(orderCalls()[0]![1]!.body as string)).toEqual({
    profileId,
    productId: product.id,
    orderType: 'electricity',
    address: {
      provinceId: address.provinceId,
      cityId: address.cityId,
      fullAddress: address.fullAddress,
      postalCode: address.postalCode,
    },
  });
  expect(container.querySelector<HTMLInputElement>('input[name="product"]')?.disabled).toBe(true);
  await act(async () => complete(response(savedOrder)));
  expect(container.textContent).toContain(t('electricity.order.success.title', 'en'));
  expect(notices.success).toHaveBeenCalledTimes(1);
});

it.each([
  { key: 'id', value: '' },
  { key: 'profileId', value: 'other-profile' },
  { key: 'productId', value: 'other-product' },
  { key: 'orderType', value: 'other' },
  { key: 'status', value: 'PAID' },
  { key: 'snapshotProvinceId', value: 'other' },
  { key: 'snapshotCityId', value: 'other' },
  { key: 'snapshotFullAddress', value: 'other' },
  { key: 'snapshotPostalCode', value: 'other' },
])(
  'does not acknowledge an order whose $key differs from the submitted purchase',
  async ({ key, value }) => {
    orderReply = async () => response({ ...savedOrder, [key]: value });
    await mount();
    await act(async () => submit().click());
    expect(notices.success).not.toHaveBeenCalled();
    expect(notices.error).toHaveBeenCalledWith(t('electricity.order.error.create', 'en'));
    expect(submit().disabled).toBe(false);
    expect(container.querySelector<HTMLInputElement>('input[name="product"]')?.checked).toBe(true);
  }
);

it.each([null, 'saved', {}, { id: 'order-1' }].map((body) => ({ body })))(
  'rejects incomplete successful response $body and permits retry',
  async ({ body }) => {
    orderReply = async () => response(body);
    await mount();
    await act(async () => submit().click());
    expect(notices.success).not.toHaveBeenCalled();
    orderReply = async () => response(savedOrder);
    await act(async () => submit().click());
    expect(orderCalls()).toHaveLength(2);
    expect(notices.success).toHaveBeenCalledTimes(1);
  }
);

it.each(['http', 'network'])('retains the purchase after a %s failure', async (kind) => {
  orderReply = async () => {
    if (kind === 'network') throw new TypeError('offline');
    return response({}, 503);
  };
  await mount();
  await act(async () => submit().click());
  expect(notices.success).not.toHaveBeenCalled();
  expect(notices.error).toHaveBeenCalledWith(t('electricity.order.error.create', 'en'));
  expect(submit().disabled).toBe(false);
});

it.each([
  { body: null },
  { body: {} },
  { body: { activeProfileId: profileId, isVerified: true } },
  { body: { activeProfileId: null, verificationRequired: false, isVerified: false } },
  { body: { activeProfileId: profileId, verificationRequired: true, isVerified: false } },
])(
  'never presents an actionable purchase without verified current profile state $body',
  async ({ body }) => {
    replies.set('/api/profiles/verification-status', body);
    await mount();
    expect(container.querySelector('input[name="product"]')).toBeNull();
    expect(orderCalls()).toHaveLength(0);
  }
);

it.each([
  { url: '/api/products', body: { products: [] } },
  { url: '/api/products', body: [{ ...product, price: '1e3' }] },
  { url: '/api/products', body: [{ ...product, title: [] }] },
  { url: `/api/profiles/${profileId}/addresses`, body: { addresses: [null] } },
  { url: `/api/profiles/${profileId}/addresses`, body: { addresses: [{ id: 'broken' }] } },
])('blocks ordering with malformed catalogue/address response $body', async ({ url, body }) => {
  replies.set(url, body);
  await mount();
  expect(submit().disabled).toBe(true);
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(orderCalls()).toHaveLength(0);
});

it('saves a new address for the active profile and selects only its confirmed result', async () => {
  await mount();
  await openAddress();
  expect(submit().disabled).toBe(true);
  await clickText('electricity.order.saveAndUse');
  const writes = fetchMock.mock.calls.filter(
    ([url, init]) => url === `/api/profiles/${profileId}/addresses` && init?.method === 'POST'
  );
  expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0]![1]!.body as string)).toEqual({
    provinceId: address.provinceId,
    cityId: address.cityId,
    fullAddress: 'New delivery address',
    postalCode: '2345678901',
  });
  expect(
    container.querySelector<HTMLInputElement>('input[name="address"][value="new-address"]')?.checked
  ).toBe(true);
  expect(container.querySelector('#order-address-fullAddress')).toBeNull();
  expect(submit().disabled).toBe(false);
});

it.each(['wrong-profile', 'wrong-address', 'http', 'network'])(
  'retains address edits and blocks purchase after %s save failure',
  async (kind) => {
    addressReply = async (input) => {
      if (kind === 'network') throw new TypeError('offline');
      if (kind === 'http') return response({}, 503);
      return response({
        ...input,
        id: 'new-address',
        profileId: kind === 'wrong-profile' ? 'other-profile' : profileId,
        mainAddress: false,
        fullAddress: kind === 'wrong-address' ? 'Other delivery address' : input.fullAddress,
      });
    };
    await mount();
    await openAddress();
    await clickText('electricity.order.saveAndUse');
    expect(notices.success).not.toHaveBeenCalled();
    expect(notices.error).toHaveBeenCalledWith(t('settings.addresses.error.create', 'en'));
    expect(container.querySelector<HTMLTextAreaElement>('#order-address-fullAddress')?.value).toBe(
      '  New delivery address  '
    );
    expect(submit().disabled).toBe(true);
    await clickText('electricity.order.cancel');
    expect(submit().disabled).toBe(false);
    expect(orderCalls()).toHaveLength(0);
  }
);
