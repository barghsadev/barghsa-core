import { test, expect, type Page } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import AxeBuilder from '@axe-core/playwright';
import { documentTemplateText } from '@barghsa/i18n/document-templates';
import { t } from '@barghsa/i18n/admin-ui';
import { templateRow, templateDetail } from '../src/test/document-list-fixtures';
import { notificationTemplate } from '../src/test/content-catalogue-fixtures';

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
      path: `/tmp/barghsa-template-query-${domain}-${dark ? 'dark' : 'light'}.png`,
    });
}
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true]) {
    test(`document catalogue URLs restore search and category without losing valid drafts (${locale}, ${dark})`, async ({
      page,
    }, info) => {
      await shell(page, locale, dark);
      const word = (key: Parameters<typeof documentTemplateText>[0]) =>
        documentTemplateText(key, locale);
      const other = {
        ...templateRow,
        id: '88888888-8888-4888-8888-888888888888',
        title: 'Another agreement',
      };
      const reads: URL[] = [];
      await page.route(
        (url) => url.pathname === '/api/admin/document-templates',
        (route) => {
          reads.push(new URL(route.request().url()));
          return route.fulfill({ json: [templateRow, other] });
        }
      );
      for (const row of [templateRow, other])
        await page.route(`**/api/admin/document-templates/${row.id}`, (route) =>
          route.fulfill({ json: { ...templateDetail, ...row } })
        );
      await page.goto('/admin/document-templates?q=Agreement&category=contract');
      const list = page.getByRole('region', { name: word('listTitle'), exact: true });
      await expect(list.getByRole('button', { name: /Customer agreement/ })).toBeVisible();
      await expect(page.locator('#document-template-search')).toHaveValue('Agreement');
      await expect(page.locator('#document-template-category')).toHaveValue('contract');
      expect(Object.fromEntries(reads.at(-1)!.searchParams)).toEqual({
        search: 'Agreement',
        category: 'contract',
      });
      await list.getByRole('button', { name: /Customer agreement/ }).click();
      await page.getByRole('button', { name: word('edit'), exact: true }).click();
      await page.locator('#document-template-title').fill('Private metadata');
      await page.locator('#document-template-files').setInputFiles({
        name: 'Private.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-draft'),
      });
      const summary = page.getByRole('textbox', { name: word('changeSummary'), exact: true });
      await summary.fill('Private version summary');
      const count = reads.length;
      await page.locator('#document-template-search').fill('Unapplied');
      expect(reads).toHaveLength(count);
      expect(params(page).get('q')).toBe('Agreement');
      await page.locator('#document-template-category').selectOption('invoice');
      await expect.poll(() => reads.at(-1)?.searchParams.get('category')).toBe('invoice');
      await expect.poll(() => params(page).get('category')).toBe('invoice');
      expect(reads.at(-1)!.searchParams.get('search')).toBe('Agreement');
      await expect(page.locator('#document-template-search')).toHaveValue('Unapplied');
      await expect(page.locator('#document-template-title')).toHaveValue('Private metadata');
      await expect(summary).toHaveValue('Private version summary');
      expect(
        await page
          .locator('#document-template-files')
          .evaluate((input: HTMLInputElement) => input.files?.[0]?.name)
      ).toBe('Private.pdf');
      await page.getByRole('button', { name: word('search'), exact: true }).click();
      await expect.poll(() => reads.at(-1)?.searchParams.get('search')).toBe('Unapplied');
      await expect.poll(() => params(page).get('q')).toBe('Unapplied');
      expect(params(page).has('title')).toBe(false);
      expect(params(page).has('changeSummary')).toBe(false);
      await expect(page.locator('#document-template-title')).toHaveValue('Private metadata');
      await page.reload();
      await expect(page.locator('#document-template-search')).toHaveValue('Unapplied');
      await expect(page.locator('#document-template-category')).toHaveValue('invoice');
      await expect(page.locator('#document-template-title')).toHaveCount(0);
      await page.goBack();
      await expect(page.locator('#document-template-search')).toHaveValue('Agreement');
      await page.goForward();
      await expect(page.locator('#document-template-search')).toHaveValue('Unapplied');
      await list.getByRole('button', { name: /Customer agreement/ }).click();
      await summary.fill('Discard this summary');
      await page.locator('#document-template-files').setInputFiles({
        name: 'Private.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-draft'),
      });
      await list.getByRole('button', { name: /Another agreement/ }).click();
      await expect(
        page.getByRole('heading', { name: 'Another agreement', exact: true })
      ).toBeVisible();
      await expect(summary).toHaveValue('');
      expect(
        await page
          .locator('#document-template-files')
          .evaluate((input: HTMLInputElement) => input.files?.length)
      ).toBe(0);
      await inspect(page, locale, info.project.name, 'documents', dark);
    });
    test(`notification catalogue URLs restore all filters and discard obsolete editor work (${locale}, ${dark})`, async ({
      page,
    }, info) => {
      await shell(page, locale, dark);
      const word = (key: string) => t(`admin.notifications.${key}`, locale);
      const reads: URL[] = [];
      let failed = false;
      await page.route(
        (url) => url.pathname === '/api/admin/notifications/templates',
        (route) => {
          const url = new URL(route.request().url());
          reads.push(url);
          const status = url.searchParams.get('status') || 'draft';
          const channel = url.searchParams.get('channel') || 'in_app';
          const language = url.searchParams.get('locale') || 'fa';
          return route.fulfill({
            status: failed ? 503 : 200,
            json: failed
              ? {}
              : [
                  {
                    ...notificationTemplate(),
                    id: `template-${channel}-${language}-${status}`,
                    eventKey: 'fixture.url',
                    subject: null,
                    channel,
                    locale: language,
                    status,
                    isActive: status === 'active',
                    publishedAt: status === 'active' ? '2026-10-01T00:00:00Z' : null,
                  },
                ],
          });
        }
      );
      await page.goto('/admin/notifications?locale=fa&channel=in_app&status=draft');
      const main = page.getByRole('main');
      const root = main.locator('[data-slot="list-page"]').filter({
        has: page.getByRole('combobox', { name: word('allStatus'), exact: true }),
      });
      const content = root.locator(':scope > [data-slot="list-content"]');
      const list = main.getByRole('region', { name: word('title'), exact: true });
      const language = root.getByRole('combobox', { name: word('locale'), exact: true });
      const channel = root.getByRole('combobox', { name: word('channel'), exact: true });
      const status = root.getByRole('combobox', { name: word('allStatus'), exact: true });
      await expect(list.getByRole('button', { name: word('edit'), exact: true })).toBeVisible();
      await expect(language).toHaveValue('fa');
      await expect(channel).toHaveValue('in_app');
      await expect(status).toHaveValue('draft');
      expect(Object.fromEntries(reads.at(-1)!.searchParams)).toEqual({
        locale: 'fa',
        channel: 'in_app',
        status: 'draft',
      });
      await list.getByRole('button', { name: word('edit'), exact: true }).click();
      const body = page.locator('#notification-template-bodyTemplate');
      await body.fill('Private message draft');
      failed = true;
      await root.getByRole('button', { name: word('refresh'), exact: true }).click();
      await expect(content.locator(':scope > [role="alert"]')).toBeVisible();
      await expect(body).toHaveValue('Private message draft');
      failed = false;
      await content
        .locator(':scope > [role="alert"]')
        .getByRole('button', { name: word('retry'), exact: true })
        .click();
      await expect(content.locator(':scope > [role="alert"]')).toHaveCount(0);
      await expect(body).toHaveValue('Private message draft');
      await channel.selectOption('sms');
      await expect.poll(() => params(page).get('channel')).toBe('sms');
      await expect.poll(() => reads.at(-1)?.searchParams.get('channel')).toBe('sms');
      await expect(body).toHaveCount(0);
      expect(params(page).has('bodyTemplate')).toBe(false);
      await page.reload();
      await expect(channel).toHaveValue('sms');
      await expect(language).toHaveValue('fa');
      await expect(status).toHaveValue('draft');
      await page.goBack();
      await expect(channel).toHaveValue('in_app');
      await list.getByRole('button', { name: word('edit'), exact: true }).click();
      await body.fill('Old scope message');
      await page.goForward();
      await expect(channel).toHaveValue('sms');
      await expect(body).toHaveCount(0);
      await language.selectOption('en');
      await status.selectOption('active');
      await expect.poll(() => reads.at(-1)?.searchParams.get('status')).toBe('active');
      expect(Object.fromEntries(reads.at(-1)!.searchParams)).toEqual({
        locale: 'en',
        channel: 'sms',
        status: 'active',
      });
      await page.reload();
      await expect(language).toHaveValue('en');
      await expect(channel).toHaveValue('sms');
      await expect(status).toHaveValue('active');
      await root.scrollIntoViewIfNeeded();
      await inspect(page, locale, info.project.name, 'notifications', dark);
    });
  }
