import { fullNavigation } from './navigation-fixture';
import { expect, test, type Route } from './coverage-fixture';
import { t } from '@barghsa/i18n/app';

const profileId = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';

const details = [
  {
    name: 'consultation',
    url: `/consultations/${id}`,
    api: `/api/consultations/requests/${id}`,
    title: ['Consultation details', 'جزئیات مشاوره'],
    failure: ['Could not load this consultation.', 'دریافت جزئیات این مشاوره انجام نشد.'],
    retry: ['Reload consultation request', 'تازه‌سازی درخواست مشاوره'],
    list: '/consultations',
  },
  {
    name: 'saving',
    url: `/savings/orders/${id}`,
    api: `/api/saving/orders/${id}`,
    title: ['Saving order', 'سفارش صرفه‌جویی'],
    failure: [
      'Could not load this information. Try again.',
      'بارگذاری اطلاعات ناموفق بود. دوباره تلاش کنید.',
    ],
    retry: ['Try again', 'دوباره تلاش کنید'],
    list: '/savings/orders',
  },
  {
    name: 'solar',
    url: `/solar/requests/${id}`,
    api: `/api/solar/requests/${id}`,
    title: ['Request details', 'جزئیات درخواست'],
    failure: ['Request could not be loaded.', 'درخواست بارگذاری نشد.'],
    retry: ['Try again', 'تلاش دوباره'],
    list: '/solar/requests',
  },
  {
    name: 'electricity',
    url: `/electricity/orders/${id}`,
    api: `/api/electricity/orders/${id}`,
    title: ['Electricity order details', 'جزئیات سفارش برق'],
    failure: [t('electricity.order.detailFailed', 'en'), t('electricity.order.detailFailed', 'fa')],
    retry: ['Try again', 'تلاش دوباره'],
    list: '/electricity/orders',
    checksDenial: true,
  },
  {
    name: 'invoice',
    url: `/invoices/${id}`,
    api: `/api/invoices/${id}`,
    title: ['Invoice details', 'جزئیات فاکتور'],
    failure: [t('invoices.details.error', 'en'), t('invoices.details.error', 'fa')],
    retry: ['Try again', 'تلاش دوباره'],
    list: '/invoices',
    checksDenial: true,
    unavailable: [t('invoices.details.notFound', 'en'), t('invoices.details.notFound', 'fa')],
  },
];

for (const [index, locale] of (['en', 'fa'] as const).entries())
  for (const theme of ['light', 'dark'] as const)
    for (const detail of details)
      test(`${detail.name} detail distinguishes a temporary failure from an unavailable record (${locale}, ${theme})`, async ({
        page,
      }) => {
        await page.addInitScript(
          ({ locale, theme }) => {
            localStorage.setItem('barghsa.locale', locale);
            localStorage.setItem('barghsa.theme.v1', theme);
          },
          { locale, theme }
        );
        const commands: string[] = [];
        await page.route('**/api/**', (route) => {
          const request = route.request();
          if (new URL(request.url()).pathname.startsWith(`${detail.api}/`)) {
            if (request.method() !== 'GET') commands.push(request.url());
          }
          return route.fulfill({ status: 404, json: {} });
        });
        await page.route('**/api/auth/user', (route) =>
          route.fulfill({
            json: {
              userId: 'detail-reader',
              isStaff: false,
              operatingContext: 'customer',
              navigation: fullNavigation('customer'),
              requiresTosAcceptance: false,
            },
          })
        );
        await page.route('**/api/profiles', (route) =>
          route.fulfill({
            json: {
              profiles: [{ id: profileId, profileType: 'INDIVIDUAL', title: 'Detail reader' }],
              activeProfileId: profileId,
              hasDefault: true,
            },
          })
        );
        await page.route('**/api/user/settings/timezone', (route) =>
          route.fulfill({ json: { timezone: 'Asia/Tehran' } })
        );
        let first: Route | undefined;
        const methods: string[] = [];
        await page.route(`**${detail.api}`, (route) => {
          methods.push(route.request().method());
          if (methods.length === 1) {
            first = route;
            return;
          }
          return route.fulfill({
            status: detail.checksDenial && theme === 'light' ? 403 : 404,
            json: { message: 'Private provider detail' },
          });
        });

        await page.goto(detail.url);
        const main = page.getByRole('main').last();
        await expect(
          main.getByRole('heading', { name: detail.title[index], level: 1 })
        ).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
        await expect
          .poll(() => page.locator('html').evaluate((node) => node.classList.contains('dark')))
          .toBe(theme === 'dark');
        const loading = main.locator('[data-slot="loading-status"]');
        const retry = main.getByRole('button', { name: detail.retry[index], exact: true });
        await expect(loading).toBeVisible();
        await expect(retry.and(main.getByRole('button', { disabled: false }))).toHaveCount(0);
        await expect.poll(() => first !== undefined).toBe(true);
        await first!.fulfill({ status: 503, json: { message: 'Private provider detail' } });
        const failure = main.getByRole('alert').filter({ hasText: detail.failure[index]! });
        if (detail.checksDenial) await expect(failure).toContainText(detail.failure[index]!);
        else await expect(failure).toHaveText(detail.failure[index]!);
        await expect(loading).toHaveCount(0);
        await retry.press('Enter');
        const unavailable =
          detail.unavailable?.[index] ??
          (locale === 'fa' ? 'این مورد در دسترس نیست.' : 'Record unavailable.');
        await expect(main.getByRole('alert').filter({ hasText: unavailable })).toHaveText(
          unavailable
        );
        await expect(retry).toHaveCount(0);
        await expect(loading).toHaveCount(0);
        await expect(main.locator(`a[href="${detail.list}"]`)).toBeVisible();
        await expect(main).not.toContainText('Private provider detail');
        expect(methods).toEqual(['GET', 'GET']);
        expect(commands).toEqual([]);
      });
