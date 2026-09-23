import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { SavingsPage } from '../routes/_app/savings.js';
import { SavingAgreementEditor } from './SavingAgreementEditor.js';

vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: (value: string) => `${value} IRR` }),
}));
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: ({ action }: { action: { path: string } }) => <p>{action.path}</p>,
}));

afterEach(() => vi.unstubAllGlobals());

it.each(['en', 'fa'] as const)(
  'shows saving plans and only the published agreement in %s',
  async (locale) => {
    document.documentElement.lang = locale;
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              plans: [
                {
                  id: 'plan-1',
                  title: { en: 'Efficient home', fa: 'خانه کم‌مصرف' },
                  description: { en: 'Reduce usage', fa: 'کاهش مصرف' },
                  price: '100000',
                  status: 'active',
                  available: true,
                  hardware: [
                    {
                      id: 'hardware-1',
                      title: { en: 'Controller', fa: 'کنترلگر' },
                      description: null,
                      price: '200000',
                      status: 'active',
                    },
                  ],
                  agreement: {
                    versionId: 'agreement-1',
                    title: 'Published terms',
                    body: 'Accepted text',
                    effectiveFrom: '2026-09-23T00:00:00Z',
                  },
                },
                {
                  id: 'plan-2',
                  title: { en: 'Later plan', fa: 'طرح آینده' },
                  description: null,
                  price: null,
                  status: 'inactive',
                  available: false,
                  hardware: [],
                  agreement: null,
                },
              ],
            })
          )
      )
    );
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<SavingsPage />));
      expect(container.textContent).toContain(locale === 'fa' ? 'خانه کم‌مصرف' : 'Efficient home');
      expect(container.textContent).toContain(locale === 'fa' ? 'کنترلگر' : 'Controller');
      expect(container.textContent).toContain('Accepted text');
      expect(container.textContent).toContain(locale === 'fa' ? 'طرح آینده' : 'Later plan');
      expect(container.textContent).toContain(locale === 'fa' ? 'در دسترس نیست' : 'Unavailable');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  }
);

it('offers an explicit publish action for a staff agreement draft', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            agreements: [
              {
                id: 'draft-1',
                title: 'New terms',
                body: 'Draft text',
                status: 'draft',
                effective_from: null,
              },
              {
                id: 'active-1',
                title: 'Current terms',
                body: 'Current text',
                status: 'active',
                effective_from: '2026-09-01T00:00:00Z',
              },
            ],
          })
        )
    )
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(<SavingAgreementEditor planId="plan-1" onChanged={() => {}} />)
    );
    expect(container.textContent).toContain('Current terms');
    expect(container.textContent).toContain('New terms');
    const activate = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Activate agreement'
    );
    await act(async () => activate?.click());
    expect(container.textContent).toContain(
      '/api/admin/catalogue/saving-plans/plan-1/agreements/draft-1/activate'
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
