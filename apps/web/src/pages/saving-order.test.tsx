import { QueryProvider } from '../test/query-provider.js';
import { fireEvent, within } from '@testing-library/dom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { SavingsOrderPage } from './SavingsOrderPage.js';
import { tSaving } from '@barghsa/i18n/saving';

const router = vi.hoisted(() => ({
  step: undefined as unknown,
  listeners: new Set<() => void>(),
  navigate: vi.fn(async ({ search }: { search?: { step?: unknown } }) => {
    if (!search) return;
    router.step = search.step;
    for (const listener of router.listeners) listener();
  }),
}));
vi.mock('@tanstack/react-router', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    createFileRoute: () => () => ({}),
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
    useNavigate: () => router.navigate,
    useSearch: () =>
      useSyncExternalStore(
        (listener) => {
          router.listeners.add(listener);
          return () => {
            router.listeners.delete(listener);
          };
        },
        () => router.step
      ),
    useBlocker: () => ({ status: 'idle' }),
  };
});
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: (value: string) => `${value} IRR`, number: String }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  router.step = undefined;
  router.listeners.clear();
  sessionStorage.clear();
});

it.each(['en', 'fa'] as const)(
  'prefills the sole plan and address and requires an explicit equipment choice in %s',
  async (locale) => {
    document.documentElement.lang = locale;
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    let failNextSave = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, options?: RequestInit) => {
        if (url === '/api/saving/orders/draft?profileId=profile-1') {
          if (options?.method === 'PUT' && failNextSave) return new Response(null, { status: 503 });
          return new Response(
            JSON.stringify(
              options?.method === 'PUT'
                ? {
                    currentStep: JSON.parse(options.body as string).currentStep,
                    data: JSON.parse(options.body as string).data,
                    updatedAt: new Date().toISOString(),
                  }
                : { currentStep: 1, data: null, updatedAt: null }
            )
          );
        }
        if (url === '/api/profiles')
          return new Response(
            JSON.stringify({
              activeProfileId: 'profile-1',
              profiles: [{ id: 'profile-1', profileType: 'INDIVIDUAL' }],
            })
          );
        if (url === '/api/saving/plans')
          return new Response(
            JSON.stringify({
              plans: [
                {
                  id: 'plan-1',
                  title: { fa: 'طرح خانه', en: 'Home plan' },
                  description: null,
                  price: '100000',
                  status: 'active',
                  available: true,
                  hardware: [
                    {
                      id: 'device-1',
                      title: { fa: 'دستگاه', en: 'Device' },
                      description: null,
                      price: '200000',
                      status: 'active',
                    },
                    {
                      id: 'depleted-device',
                      title: { fa: 'ناموجود', en: 'Depleted' },
                      description: null,
                      price: null,
                      status: 'active',
                      stock_tracking: true,
                      available_count: 0,
                    },
                    {
                      id: 'stocked-device',
                      title: { fa: 'موجود', en: 'Stocked' },
                      description: null,
                      price: '250000',
                      status: 'active',
                      stock_tracking: true,
                      available_count: 2,
                    },
                    {
                      id: 'retired-device',
                      title: { fa: 'غیرفعال', en: 'Retired' },
                      description: null,
                      price: '300000',
                      status: 'inactive',
                      stock_tracking: true,
                    },
                  ],
                  agreement: { versionId: 'agreement-1', title: 'Terms', body: 'Agreement body' },
                },
              ],
            })
          );
        if (url === '/api/profiles/profile-1/addresses')
          return Response.json({
            addresses: [
              {
                id: 'address-1',
                profileId: 'profile-1',
                provinceId: 'province-1',
                cityId: 'city-1',
                fullAddress: 'Installation address',
                postalCode: '1234567890',
                mainAddress: false,
              },
            ],
          });
        throw new Error(`Unexpected ${url}`);
      })
    );
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <QueryProvider>
            <SavingsOrderPage />
          </QueryProvider>
        )
      );
      expect(container.textContent).toContain(locale === 'fa' ? 'طرح خانه' : 'Home plan');
      expect(container.querySelector<HTMLInputElement>('input[value="plan-1"]')?.checked).toBe(
        true
      );
      expect(fetch).not.toHaveBeenCalledWith(
        '/api/saving/orders/draft?profileId=profile-1',
        expect.objectContaining({ method: 'PUT' })
      );
      const next = Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === (locale === 'fa' ? 'ادامه' : 'Continue')
      );
      expect(next?.disabled).toBe(true);
      expect(container.textContent).toContain(locale === 'fa' ? 'دستگاه' : 'Device');
      const hardware = (id: string) =>
        container.querySelector<HTMLInputElement>(`input[value="${id}"]`)!;
      expect(hardware('depleted-device').disabled).toBe(true);
      expect(hardware('retired-device').disabled).toBe(true);
      expect(hardware('stocked-device').disabled).toBe(false);
      expect(container.querySelector('input[name="hardwareId"]:checked')).toBeNull();
      expect(hardware('depleted-device').closest('label')?.textContent).toContain(
        tSaving('outOfStock', locale)
      );
      expect(hardware('stocked-device').closest('label')?.textContent).toContain(
        tSaving('inStock', locale)
      );

      expect(hardware('device-1').closest('label')?.textContent).toContain(
        tSaving('stockPending', locale)
      );
      await act(async () => {
        (container.querySelector('input[value="device-1"]') as HTMLInputElement).click();
      });
      const confirm = container.querySelector<HTMLInputElement>('input[name="hardwareConfirmed"]')!;
      expect(confirm.closest('label')?.textContent).toContain(tSaving('confirmHardware', locale));
      expect(confirm.checked).toBe(false);
      expect(next?.disabled).toBe(true);
      await act(async () => confirm.click());
      expect(next?.disabled).toBe(false);
      failNextSave = true;
      await act(async () => next?.click());
      expect(fetch).toHaveBeenCalledWith(
        '/api/saving/orders/draft?profileId=profile-1',
        expect.objectContaining({ method: 'PUT' })
      );
      expect(container.textContent).toContain(
        locale === 'fa' ? 'اطلاعات واردشده باقی مانده است' : 'Your entries are still here'
      );
      expect((container.querySelector('input[value="device-1"]') as HTMLInputElement).checked).toBe(
        true
      );
      failNextSave = false;
      await act(async () => next?.click());
      expect(
        container.querySelector<HTMLInputElement>('input[name="addressId"][value="address-1"]')
          ?.checked
      ).toBe(true);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  }
);

for (const locale of ['en', 'fa'] as const)
  it.each(['malformed', 'network'] as const)(
    `retries an unconfirmed inline address with its original body and key (%s, ${locale})`,
    async (failure) => {
      document.documentElement.lang = locale;
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
      const profileId = '11111111-1111-4111-8111-111111111111';
      const planId = '22222222-2222-4222-8222-222222222222';
      const hardwareId = '33333333-3333-4333-8333-333333333333';
      const provinceId = '44444444-4444-4444-8444-444444444444';
      const cityId = '55555555-5555-4555-8555-555555555555';
      const writes: Array<Record<string, unknown>> = [];
      const address = {
        id: '66666666-6666-4666-8666-666666666666',
        profileId,
        provinceId,
        cityId,
        fullAddress: 'Captured installation site',
        postalCode: '1234567890',
        mainAddress: true,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      };
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, options?: RequestInit) => {
          if (url === '/api/profiles')
            return Response.json({
              activeProfileId: profileId,
              profiles: [{ id: profileId, profileType: 'INDIVIDUAL' }],
            });
          if (url === '/api/saving/plans')
            return Response.json({
              plans: [
                {
                  id: planId,
                  title: { en: 'Plan', fa: 'طرح' },
                  description: null,
                  price: '100000',
                  status: 'active',
                  available: true,
                  hardware: [
                    {
                      id: hardwareId,
                      title: { en: 'Device', fa: 'دستگاه' },
                      description: null,
                      price: '200000',
                      status: 'active',
                    },
                  ],
                  agreement: { versionId: 'agreement-1', title: 'Terms', body: 'Agreement' },
                },
              ],
            });
          if (url === `/api/profiles/${profileId}/addresses`) {
            if (options?.method !== 'POST') return Response.json({ addresses: [] });
            writes.push(JSON.parse(String(options.body)));
            if (writes.length === 1) {
              if (failure === 'network') throw new Error('Lost acknowledgement after creation');
              return Response.json({}, { status: 201 });
            }
            return Response.json(address, { status: 201 });
          }
          if (url === `/api/saving/orders/draft?profileId=${profileId}`)
            return Response.json(
              options?.method === 'PUT'
                ? { ...JSON.parse(String(options.body)), updatedAt: null }
                : { currentStep: 1, data: null, updatedAt: null }
            );
          if (url === '/api/saving/orders/duplicate')
            return Response.json({ duplicate: false, preventActiveDuplicates: false });
          if (url === '/api/saving/orders/quote')
            return Response.json({
              reviewDigest: 'a'.repeat(64),
              plan: { id: planId, title: { en: 'Quoted plan', fa: 'طرح استعلام‌شده' } },
              hardware: {
                id: hardwareId,
                title: { en: 'Quoted device', fa: 'دستگاه استعلام‌شده' },
              },
              billIdentifier: '12345678',
              address: {
                id: address.id,
                province_id: provinceId,
                city_id: cityId,
                full_address: 'Updated quoted installation site',
                postal_code: '9876543210',
              },
              agreement: {
                versionId: 'agreement-1',
                title: 'Quoted terms',
                body: 'Quoted agreement body',
              },
              lines: [],
              subtotalIrR: '300000',
              discountIrR: '0',
              vatIrR: '0',
              totalIrR: '300000',
            });
          if (url === `/api/wallet/${profileId}`)
            return Response.json({ availableBalance: '500000' });
          if (url === '/api/geography/provinces')
            return Response.json([{ id: provinceId, nameFa: 'استان', nameEn: 'Province' }]);
          if (url === `/api/geography/provinces/${provinceId}/cities`)
            return Response.json([{ id: cityId, provinceId, nameFa: 'شهر', nameEn: 'City' }]);
          throw new Error(`Unexpected ${url}`);
        })
      );
      const container = document.createElement('div');
      document.body.append(container);
      const root = createRoot(container);
      const button = (text: string) =>
        [...container.querySelectorAll<HTMLButtonElement>('button')].find(
          (el) => el.textContent === text
        )!;
      async function value(selector: string, next: string) {
        await act(async () => {
          const element = container.querySelector<
            HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
          >(selector)!;
          Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!.call(
            element,
            next
          );
          element.dispatchEvent(
            new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })
          );
        });
      }
      async function selectLocation(id: string, name: string) {
        const input = container.querySelector<HTMLInputElement>(id)!;
        await vi.waitFor(() => expect(input.disabled).toBe(false));
        await act(async () => input.focus());
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        const option = await within(document.body).findByRole('option', { name });
        await act(async () => fireEvent.click(option));
      }
      try {
        await act(async () =>
          root.render(
            <QueryProvider>
              <SavingsOrderPage />
            </QueryProvider>
          )
        );
        await act(async () =>
          container.querySelector<HTMLInputElement>(`input[value="${planId}"]`)!.click()
        );
        await act(async () => {
          container.querySelector<HTMLInputElement>(`input[value="${hardwareId}"]`)!.click();
          container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
        });
        await act(async () => button(tSaving('next', locale)).click());
        await value('input[name=billIdentifier]', '12345678');
        const review = () => button(tSaving('stepReview', locale));
        expect(review().disabled).toBe(true);
        await act(async () => button(tSaving('newAddress', locale)).click());
        await selectLocation('#saving-address-province', locale === 'fa' ? 'استان' : 'Province');
        await selectLocation('#saving-address-city', locale === 'fa' ? 'شهر' : 'City');
        await value('#saving-address-full', address.fullAddress);
        await value('input[name=postalCode]', address.postalCode);
        await act(async () => button(tSaving('saveAddress', locale)).click());
        await vi.waitFor(() => expect(writes).toHaveLength(1));
        expect(writes[0]!.idempotencyKey).toMatch(/^[a-f0-9-]{36}$/);
        expect(
          container.querySelector<HTMLTextAreaElement>('#saving-address-full')!.matches(':disabled')
        ).toBe(true);
        await act(async () => button(tSaving('retryAddress', locale)).click());
        await vi.waitFor(() => expect(writes).toHaveLength(2));
        expect(writes[1]).toEqual(writes[0]);
        await vi.waitFor(() =>
          expect(
            container.querySelector<HTMLInputElement>(`input[value="${address.id}"]`)?.checked
          ).toBe(true)
        );
        expect(container.querySelector('#saving-address-full')).toBeNull();
        await vi.waitFor(() => expect(review().disabled).toBe(false));
        await act(async () => review().click());
        await vi.waitFor(() => expect(container.textContent).toContain('300000 IRR'));
        expect(container.textContent).toContain('Updated quoted installation site');
        expect(container.textContent).toContain('9876543210');
        expect(container.textContent).not.toContain(address.fullAddress);
        expect(container.textContent).toContain(
          locale === 'fa' ? 'طرح استعلام‌شده' : 'Quoted plan'
        );
        expect(container.textContent).toContain(
          locale === 'fa' ? 'دستگاه استعلام‌شده' : 'Quoted device'
        );
        expect(container.textContent).toContain('Quoted agreement body');
      } finally {
        await act(async () => root.unmount());
        container.remove();
      }
    }
  );

it.each([
  [
    'unsupported profile type',
    { activeProfileId: 'profile-1', profiles: [{ id: 'profile-1', profileType: 'UNKNOWN' }] },
    'intakeLoadError',
  ],
  [
    'legal profile',
    { activeProfileId: 'profile-1', profiles: [{ id: 'profile-1', profileType: 'LEGAL' }] },
    'profileRequired',
  ],
  ['no active profile', { activeProfileId: null, profiles: [] }, 'profileRequired'],
] as const)('blocks private saving intake for %s', async (_case, profile, message) => {
  const locale = 'en';
  document.documentElement.lang = locale;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const read = vi.fn(async (url: string) => {
    if (url === '/api/profiles') return Response.json(profile);
    if (url === '/api/saving/plans') return Response.json({ plans: [] });
    throw new Error(`Unexpected ${url}`);
  });
  vi.stubGlobal('fetch', read);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <QueryProvider>
          <SavingsOrderPage />
        </QueryProvider>
      )
    );
    expect(container.querySelector('[role=alert]')?.textContent).toContain(
      tSaving(message, locale)
    );
    expect(read.mock.calls.map(([url]) => url).sort()).toEqual([
      '/api/profiles',
      '/api/saving/plans',
    ]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
