import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { geographyText } from '@barghsa/i18n/geography';
import { t } from '@barghsa/i18n/crm';
import { crmUser } from '../src/test/crm-recovery-fixtures';
test.use({ viewport: { width: 390, height: 844 } });
async function shell(page: Page, locale: 'en' | 'fa', darkMode: boolean) {
  await crmShell(page, locale);
  await page.route('**/api/public/branding/config', (route) =>
    route.fulfill({
      json: {
        appTitle: 'Barghsa',
        appTitleFa: 'برق‌آسا',
        supportEmail: 'support@example.test',
        supportPhone: '+982112345678',
        supportMobile: '+989121234567',
        backgroundColor: '#f6f7f4',
        darkBackgroundColor: '#15201c',
        fontFamily: 'vazirmatn',
        borderRadiusRem: 0.75,
        spacingScale: 1,
        numberStyle: 'locale',
        slogan: '',
        primaryColor: '#2563eb',
        secondaryColor: '#64748b',
        accentColor: '#f59e0b',
        logoUrl: null,
        faviconUrl: null,
        darkMode,
      },
    })
  );
}
const url = (page: Page) => new URL(page.url()).searchParams;
async function inspect(page: Page, locale: string, project: string, name: string, dark: boolean) {
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (locale === 'fa' && project === 'mobile-safari')
    await page.screenshot({
      path: `/tmp/barghsa-list-query-${name}-${dark ? 'dark' : 'light'}.png`,
      fullPage: true,
    });
}
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true]) {
    test(`geography URL restores independent province and city criteria (${locale}, ${dark})`, async ({
      page,
    }, info) => {
      await shell(page, locale, dark);
      const text = (key: Parameters<typeof geographyText>[0]) => geographyText(key, locale);
      const reads: URL[] = [];
      const province = {
        id: 'selected',
        nameFa: 'تهران',
        nameEn: 'Selected Province',
        status: 'active',
      };
      await page.route('**/api/admin/geography/provinces?*', (route) => {
        const query = new URL(route.request().url());
        reads.push(query);
        return route.fulfill({ json: { provinces: [province], total: 61 } });
      });
      await page.route('**/api/admin/geography/provinces/selected/cities?*', (route) => {
        const query = new URL(route.request().url());
        reads.push(query);
        return route.fulfill({
          json: {
            cities: [{ ...province, id: 'city', provinceId: province.id, nameEn: 'Selected City' }],
            total: 61,
          },
        });
      });
      await page.goto(
        '/admin/geography?q=Province&status=active&page=2&province=selected&city_q=City&city_status=inactive&city_page=2'
      );
      const cities = page.getByRole('region', {
        name: `${text('cities')} — ${locale === 'fa' ? province.nameFa : province.nameEn}`,
        exact: true,
      });
      await expect(cities).toBeVisible();
      await expect(page.getByRole('textbox', { name: text('search'), exact: true })).toHaveValue(
        'Province'
      );
      await expect(
        cities.getByRole('textbox', { name: text('citySearch'), exact: true })
      ).toHaveValue('City');
      const lastCityRead = () =>
        reads.filter((query) => query.pathname.endsWith('/cities')).at(-1)!;
      expect(lastCityRead().searchParams.get('page')).toBe('2');
      expect(lastCityRead().searchParams.get('status')).toBe('inactive');
      await cities.getByRole('button', { name: text('next'), exact: true }).click();
      await expect.poll(() => url(page).get('city_page')).toBe('3');
      expect(url(page).get('page')).toBe('2');
      await page.reload();
      await expect(cities).toBeVisible();
      await expect.poll(() => lastCityRead().searchParams.get('page')).toBe('3');
      await cities
        .getByRole('combobox', { name: text('filterStatus'), exact: true })
        .selectOption('active');
      await expect.poll(() => url(page).get('city_page')).toBeNull();
      expect(url(page).get('page')).toBe('2');
      await page.goBack();
      await expect.poll(() => url(page).get('city_page')).toBe('3');
      await expect(
        cities.getByRole('combobox', { name: text('filterStatus'), exact: true })
      ).toHaveValue('inactive');
      await page.goForward();
      await expect(
        cities.getByRole('combobox', { name: text('filterStatus'), exact: true })
      ).toHaveValue('active');
      await cities
        .getByRole('textbox', { name: text('citySearch'), exact: true })
        .fill('Changed city');
      await expect.poll(() => url(page).get('city_q')).toBe('Changed city');
      expect(url(page).get('q')).toBe('Province');
      await page
        .getByRole('combobox', { name: text('filterStatus'), exact: true })
        .first()
        .selectOption('inactive');
      await expect(cities).toHaveCount(0);
      expect(url(page).get('page')).toBeNull();
      expect(url(page).get('province')).toBeNull();
      expect(url(page).get('city_q')).toBeNull();
      await page.goBack();
      await expect(cities).toBeVisible();
      await expect(
        cities.getByRole('textbox', { name: text('citySearch'), exact: true })
      ).toHaveValue('Changed city');
      expect(url(page).get('page')).toBe('2');
      await inspect(page, locale, info.project.name, 'geography', dark);
    });
    test(`CRM URL restores filters, dates, sort and exact cursor (${locale}, ${dark})`, async ({
      page,
    }, info) => {
      await shell(page, locale, dark);
      const label = (key: string) => t(`crm.list.${key}`, locale);
      const reads: URL[] = [];
      await page.route('**/api/crm/users?*', (route) => {
        const query = new URL(route.request().url());
        reads.push(query);
        return route.fulfill({
          json: {
            users: [crmUser],
            hasMore: true,
            cursor: query.searchParams.get('cursor') === 'next' ? 'later' : 'next',
          },
        });
      });
      await page.goto(
        '/admin/crm?q=Customer&type=LEGAL&verification=PENDING&staffOnly=true&dateFrom=2026-02-28&dateTo=2026-03-01&sort=username&order=asc&cursor=restored'
      );
      await expect(page.getByRole('table')).toBeVisible();
      await expect(page.locator('#crm-search')).toHaveValue('Customer');
      await expect(page.locator('#crm-type')).toHaveValue('LEGAL');
      await expect(page.locator('#crm-verification')).toHaveValue('PENDING');
      await expect(page.getByRole('checkbox', { name: label('staffOnly') })).toBeChecked();
      expect(reads.at(-1)!.searchParams.get('cursor')).toBe('restored');
      expect(reads.at(-1)!.searchParams.get('dateFrom')).toBe('2026-02-27T20:30:00.000Z');
      expect(reads.at(-1)!.searchParams.get('dateTo')).toBe('2026-03-01T20:29:59.999999Z');
      await expect(
        page.getByRole('button', { name: label('previous'), exact: true })
      ).toBeDisabled();
      await page.getByRole('button', { name: label('next'), exact: true }).click();
      await expect.poll(() => url(page).get('cursor')).toBe('next');
      await expect(
        page.getByRole('button', { name: label('previous'), exact: true })
      ).toBeEnabled();
      await page.reload();
      await expect(page.getByRole('table')).toBeVisible();
      expect(reads.at(-1)!.searchParams.get('cursor')).toBe('next');
      await expect(
        page.getByRole('button', { name: label('previous'), exact: true })
      ).toBeDisabled();
      await page.locator('#crm-verification').selectOption('VERIFIED');
      await expect.poll(() => url(page).get('cursor')).toBeNull();
      expect(url(page).get('q')).toBe('Customer');
      // A back navigation cancels a search that has not reached its debounce deadline.
      await page.clock.install({ time: new Date('2026-10-01T12:00:00Z') });
      await page.clock.pauseAt(new Date('2026-10-01T12:00:01Z'));
      await page.locator('#crm-search').fill('Obsolete typing');
      await page.goBack();
      await expect(page.locator('#crm-search')).toHaveValue('Customer');
      await expect(page.locator('#crm-verification')).toHaveValue('PENDING');
      await expect.poll(() => reads.at(-1)!.searchParams.get('cursor')).toBe('next');
      await page.clock.resume();
      await page.goForward();
      await expect(page.locator('#crm-verification')).toHaveValue('VERIFIED');
      await page.locator('#crm-search').fill('Changed customer');
      await expect.poll(() => url(page).get('q')).toBe('Changed customer');
      expect(reads.some((query) => query.searchParams.get('search') === 'Obsolete typing')).toBe(
        false
      );
      await page.getByRole('button', { name: label('clear'), exact: true }).click();
      await expect(page.locator('#crm-search')).toHaveValue('');
      await expect.poll(() => url(page).has('verification')).toBe(false);
      for (const key of ['q', 'type', 'dateFrom', 'dateTo', 'sort', 'order', 'staffOnly', 'cursor'])
        expect(url(page).has(key)).toBe(false);
      await inspect(page, locale, info.project.name, 'crm', dark);
    });
  }
