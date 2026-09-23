import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { SavingsOrderPage } from './SavingsOrderPage.js';

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({}),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => () => Promise.resolve(),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: (value: string) => `${value} IRR`, number: String }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
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
                    currentStep: 2,
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
      expect((container.querySelector('input[value="device-1"]') as HTMLInputElement).checked).toBe(true);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  }
);
