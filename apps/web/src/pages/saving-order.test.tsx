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
  'moves from an available plan to its compatible hardware in %s',
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
                  ],
                  agreement: { versionId: 'agreement-1', title: 'Terms', body: 'Agreement body' },
                },
              ],
            })
          );
        if (url === '/api/profiles/profile-1/addresses')
          return new Response(JSON.stringify({ addresses: [] }));
        throw new Error(`Unexpected ${url}`);
      })
    );
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<SavingsOrderPage />));
      expect(container.textContent).toContain(locale === 'fa' ? 'طرح خانه' : 'Home plan');
      await act(async () =>
        (container.querySelector('input[value="plan-1"]') as HTMLInputElement).click()
      );
      const next = Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === (locale === 'fa' ? 'ادامه' : 'Continue')
      );
      expect(next?.disabled).toBe(false);
      await act(async () => next?.click());
      expect(fetch).toHaveBeenCalledWith(
        '/api/saving/orders/draft?profileId=profile-1',
        expect.objectContaining({ method: 'PUT' })
      );
      expect(container.textContent).toContain(locale === 'fa' ? 'دستگاه' : 'Device');
      expect(container.textContent).toContain(
        locale === 'fa'
          ? 'موجودی پس از تأیید کارشناس مشخص می‌شود.'
          : 'Availability is subject to staff confirmation.'
      );
      expect(container.textContent).toContain(
        locale === 'fa' ? 'انتخاب این دستگاه را تأیید می‌کنم' : 'I confirm this equipment choice'
      );
      await act(async () => {
        (container.querySelector('input[value="device-1"]') as HTMLInputElement).click();
        (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
      });
      failNextSave = true;
      await act(async () => next?.click());
      expect(container.textContent).toContain(
        locale === 'fa' ? 'اطلاعات واردشده باقی مانده است' : 'Your entries are still here'
      );
      expect((container.querySelector('input[value="device-1"]') as HTMLInputElement).checked).toBe(
        true
      );
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
          const element = container.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
          Object.getOwnPropertyDescriptor(
            element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype,
            'value'
          )!.set!.call(element, next);
          element.dispatchEvent(
            new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })
          );
        });
      }
      try {
        await act(async () => root.render(<SavingsOrderPage />));
        await act(async () =>
          container.querySelector<HTMLInputElement>(`input[value="${planId}"]`)!.click()
        );
        await act(async () => button(tSaving('next', locale)).click());
        await act(async () => {
          container.querySelector<HTMLInputElement>(`input[value="${hardwareId}"]`)!.click();
          container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
        });
        await act(async () => button(tSaving('next', locale)).click());
        await value('input[name=billIdentifier]', '12345678');
        await vi.waitFor(() => expect(button(tSaving('next', locale)).disabled).toBe(false));
        await act(async () => button(tSaving('next', locale)).click());
        await act(async () => button(tSaving('newAddress', locale)).click());
        await vi.waitFor(() =>
          expect(
            container.querySelector<HTMLSelectElement>('#saving-address-province')!.disabled
          ).toBe(false)
        );
        await value('#saving-address-province', provinceId);
        await vi.waitFor(() =>
          expect(container.querySelector<HTMLSelectElement>('#saving-address-city')!.disabled).toBe(
            false
          )
        );
        await value('#saving-address-city', cityId);
        await value('input[name=fullAddress]', address.fullAddress);
        await value('input[name=postalCode]', address.postalCode);
        await act(async () => button(tSaving('saveAddress', locale)).click());
        await vi.waitFor(() => expect(writes).toHaveLength(1));
        expect(writes[0]!.idempotencyKey).toMatch(/^[a-f0-9-]{36}$/);
        expect(
          container.querySelector<HTMLInputElement>('input[name=fullAddress]')!.matches(':disabled')
        ).toBe(true);
        await act(async () => button(tSaving('retryAddress', locale)).click());
        await vi.waitFor(() => expect(writes).toHaveLength(2));
        expect(writes[1]).toEqual(writes[0]);
        await vi.waitFor(() =>
          expect(
            container.querySelector<HTMLInputElement>(`input[value="${address.id}"]`)?.checked
          ).toBe(true)
        );
        expect(container.querySelector('input[name=fullAddress]')).toBeNull();
        expect(button(tSaving('next', locale)).disabled).toBe(false);
        await act(async () => button(tSaving('next', locale)).click());
        await act(async () =>
          container.querySelector<HTMLInputElement>('input[name=agreementAccepted]')!.click()
        );
        await act(async () => button(tSaving('next', locale)).click());
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
