import { test, expect, type Page } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/admin-ui';
import { t as appText } from '@barghsa/i18n/app';
import { notificationTemplate } from '../src/test/content-catalogue-fixtures';
import { deadLetter } from '../src/test/operational-queue-fixtures';
test.use({ viewport: { width: 390, height: 844 } });
const params = (page: Page) => new URL(page.url()).searchParams;
async function shell(page: Page, locale: 'fa' | 'en', dark: boolean) {
  await crmShell(page, locale);
  await page.route('**/api/public/branding/config', (route) =>
    route.fulfill({
      json: {
        appTitle: 'Barghsa',
        appTitleFa: 'برق‌آسا',
        supportEmail: 'support@example.test',
        supportPhone: '+982112345678',
        supportMobile: '+989121234567',
        slogan: '',
        primaryColor: '#2563eb',
        secondaryColor: '#64748b',
        accentColor: '#f59e0b',
        backgroundColor: '#f6f7f4',
        darkBackgroundColor: '#15201c',
        fontFamily: 'vazirmatn',
        borderRadiusRem: 0.75,
        spacingScale: 1,
        numberStyle: 'locale',
        logoUrl: null,
        faviconUrl: null,
        darkMode: dark,
      },
    })
  );
}
async function inspect(page: Page, locale: string, project: string, domain: string, dark: boolean) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(dark);
  expect((await new AxeBuilder({ page }).include('main > div').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (locale === 'fa' && project === 'mobile-safari')
    await page.screenshot({
      path: `/tmp/barghsa-notification-panel-query-${domain}-${dark ? 'dark' : 'light'}.png`,
    });
}
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true]) {
    test(`notification preview and queue URLs keep independent scopes and valid drafts (${locale}, ${dark})`, async ({
      page,
    }, info) => {
      await shell(page, locale, dark);
      const word = (key: string) => t(`admin.notifications.${key}`, locale);
      const base = {
        ...notificationTemplate(),
        channel: 'in_app',
        locale,
        subject: null,
        eventKey: 'fixture.versions',
      };
      const versions = [
        { ...base, id: 'draft-v3', version: 3, bodyTemplate: 'Draft preview' },
        {
          ...base,
          id: 'active-v2',
          version: 2,
          bodyTemplate: 'Active preview',
          status: 'active',
          isActive: true,
        },
        {
          ...base,
          id: 'archived-v1',
          version: 1,
          bodyTemplate: 'Archived preview',
          status: 'archived',
        },
      ];
      let failed = true;
      const catalogueReads: URL[] = [],
        queueReads: URL[] = [];
      await page.route(
        (url) => url.pathname === '/api/admin/notifications/templates',
        (route) => {
          const url = new URL(route.request().url());
          catalogueReads.push(url);
          const status = url.searchParams.get('status');
          return route.fulfill({
            status: failed ? 503 : 200,
            json: status ? versions.filter((v) => v.status === status) : versions,
          });
        }
      );
      await page.route('**/api/admin/config/delivery-window', (route) =>
        route.fulfill({ json: { timezone: 'Asia/Tehran', startHour: 9, endHour: 21 } })
      );
      await page.route('**/api/admin/failed-notifications/access', (route) =>
        route.fulfill({ json: { canView: true, canRetry: true } })
      );
      await page.route('**/api/admin/failed-notifications?*', (route) => {
        queueReads.push(new URL(route.request().url()));
        return route.fulfill({ json: [deadLetter] });
      });
      await page.goto(
        `/admin/notifications?locale=${locale}&preview_event=fixture.versions&preview_channel=in_app&preview_locale=${locale}&preview_version=draft-v3&failed_status=all&failed_channel=email&failed_severity=critical&failed_page=3`
      );
      const catalogue = page
        .locator('main [data-slot="list-page"]')
        .filter({ has: page.getByRole('combobox', { name: word('allStatus'), exact: true }) });
      await expect(catalogue.getByRole('alert')).toBeVisible();
      expect(params(page).get('preview_version')).toBe('draft-v3');
      failed = false;
      await catalogue.getByRole('button', { name: word('retry'), exact: true }).click();
      const version = page.locator('#tpl-preview-version');
      await expect(version).toHaveValue('draft-v3');
      await expect(page.locator('pre').first()).toHaveText('Draft preview');
      expect(Object.fromEntries(queueReads.at(-1)!.searchParams)).toEqual({
        channel: 'email',
        severity: 'critical',
        limit: '26',
        offset: '50',
      });
      expect(Object.fromEntries(catalogueReads.at(-1)!.searchParams)).toEqual({ locale });
      await version.selectOption('active-v2');
      await expect.poll(() => params(page).get('preview_version')).toBe('active-v2');
      await page.reload();
      await expect(version).toHaveValue('active-v2');
      await expect(page.locator('pre').first()).toHaveText('Active preview');
      await page.goBack();
      await expect(version).toHaveValue('draft-v3');
      await page.goForward();
      await expect(version).toHaveValue('active-v2');
      // The first catalogue row is the draft in both dictionaries.
      await catalogue
        .getByRole('button', { name: word('edit'), exact: true })
        .first()
        .click();
      const body = page.locator('#notification-template-bodyTemplate');
      await body.fill('Private draft preserved');
      const queue = page
        .locator('main section')
        .filter({ has: page.getByRole('heading', { name: word('deadLetter.title'), exact: true }) })
        .last();
      await queue
        .getByRole('combobox', { name: word('deadLetter.severity'), exact: true })
        .selectOption('error');
      await expect.poll(() => params(page).get('failed_severity')).toBe('error');
      expect(params(page).has('failed_page')).toBe(false);
      expect(params(page).get('preview_version')).toBe('active-v2');
      await expect(body).toHaveValue('Private draft preserved');
      await page.locator('#tpl-preview-channel').selectOption('in_app');
      await expect.poll(() => params(page).has('preview_version')).toBe(false);
      expect(params(page).get('failed_severity')).toBe('error');
      expect(params(page).get('locale')).toBe(locale);
      await expect(body).toHaveValue('Private draft preserved');
      await version.selectOption('draft-v3');
      await catalogue
        .getByRole('combobox', { name: word('allStatus'), exact: true })
        .selectOption('archived');
      await expect(version).toHaveValue('archived-v1');
      await page.goBack();
      await expect.poll(() => catalogueReads.at(-1)?.searchParams.has('status')).toBe(false);
      await expect(version).toHaveValue('draft-v3');
      await page.locator('#tpl-preview-locale').selectOption(locale);
      await page.locator('#tpl-preview-version').selectOption('draft-v3');
      await page.reload();
      await expect(version).toHaveValue('draft-v3');
      await expect(page.locator('#tpl-preview-event')).toHaveValue('fixture.versions');
      await expect(page.locator('#tpl-preview-locale')).toHaveValue(locale);
      if (locale === 'fa' && info.project.name === 'mobile-safari') {
        await version.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `/tmp/barghsa-notification-panel-query-preview-${dark ? 'dark' : 'light'}.png`,
        });
      }
      await page.getByRole('button', { name: word('preview.reset'), exact: true }).click();
      await expect.poll(() => params(page).has('preview_event')).toBe(false);
      expect(params(page).has('preview_version')).toBe(false);
      expect(params(page).get('failed_severity')).toBe('error');
      await queue.scrollIntoViewIfNeeded();
      await inspect(page, locale, info.project.name, 'combined', dark);
    });

    test(`failed notification URLs restore filters and exact page recovery (${locale}, ${dark})`, async ({
      page,
    }, info) => {
      await shell(page, locale, dark);
      const word = (key: string) => t(`admin.notifications.deadLetter.${key}`, locale);
      const common = (key: string) => t(`admin.jobs.${key}`, locale);
      let failed = false,
        denied = false;
      const reads: URL[] = [];
      const rows = Array.from({ length: 26 }, (_, index) => ({
        ...deadLetter,
        id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        eventKey: `invoice.created.${index + 1}`,
      }));
      await page.route('**/api/admin/failed-notifications/access', (route) =>
        route.fulfill({ json: { canView: true, canRetry: true } })
      );
      await page.route('**/api/admin/failed-notifications?*', (route) => {
        const url = new URL(route.request().url());
        reads.push(url);
        const second = url.searchParams.get('offset') === '50';
        return route.fulfill({
          status: denied ? 403 : failed && second ? 503 : 200,
          json: second ? [{ ...deadLetter, eventKey: 'second.page' }] : rows,
        });
      });
      await page.goto(
        '/admin/failed-notifications?failed_status=open&failed_channel=email&failed_severity=critical&failed_page=2'
      );
      const root = page.getByRole('main');
      const status = root.getByRole('combobox', { name: word('status'), exact: true });
      const channel = root.getByRole('combobox', { name: word('channel'), exact: true });
      const severity = root.getByRole('combobox', { name: word('severity'), exact: true });
      await expect(
        root.locator(
          'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
        )
      ).toHaveCount(25);
      await expect(status).toHaveValue('open');
      await expect(channel).toHaveValue('email');
      await expect(severity).toHaveValue('critical');
      expect(Object.fromEntries(reads.at(-1)!.searchParams)).toEqual({
        status: 'open',
        channel: 'email',
        severity: 'critical',
        limit: '26',
        offset: '25',
      });
      failed = true;
      await root.getByRole('button', { name: common('next'), exact: true }).click();
      await expect(root.getByRole('alert')).toBeVisible();
      await expect(
        root.locator(
          'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
        )
      ).toHaveCount(25);
      expect(params(page).get('failed_page')).toBe('3');
      const failedQuery = reads.at(-1)!.search;
      failed = false;
      await root.getByRole('button', { name: common('reload'), exact: true }).click();
      await expect(
        root.locator(
          'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
        )
      ).toHaveCount(1);
      expect(reads.at(-1)!.search).toBe(failedQuery);
      await page.reload();
      await expect(
        root.locator(
          'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
        )
      ).toHaveCount(1);
      expect(reads.at(-1)!.search).toBe(failedQuery);
      await root.getByRole('button', { name: `${word('retry')} second.page`, exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.goBack();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(
        root.locator(
          'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
        )
      ).toHaveCount(25);
      await page.goForward();
      await expect(
        root.locator(
          'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
        )
      ).toHaveCount(1);
      await status.selectOption('');
      await expect.poll(() => params(page).get('failed_status')).toBe('all');
      await expect.poll(() => reads.at(-1)?.searchParams.has('status')).toBe(false);
      expect(params(page).has('failed_page')).toBe(false);
      await severity.selectOption('error');
      await channel.selectOption('sms');
      await expect.poll(() => reads.at(-1)?.searchParams.get('channel')).toBe('sms');
      await page.reload();
      await expect(status).toHaveValue('');
      await expect(channel).toHaveValue('sms');
      await expect(severity).toHaveValue('error');
      await root
        .getByRole('button', { name: `${word('retry')} invoice.created.1`, exact: true })
        .click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: appText('team.cancel', locale), exact: true })
        .click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.goBack();
      await expect(channel).toHaveValue('email');
      await inspect(page, locale, info.project.name, 'queue', dark);
      denied = true;
      await root.getByRole('button', { name: common('refresh'), exact: true }).click();
      await expect(
        root.locator(
          'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
        )
      ).toHaveCount(0);
      await expect(root.getByRole('alert')).toContainText(word('accessDenied'));
    });
  }
