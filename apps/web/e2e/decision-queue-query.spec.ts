import { test, expect, type Page } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/admin-ui';
import { reconciliationItem } from '../src/test/payment-review-fixtures';
test.use({ viewport: { width: 390, height: 844 } });
const params = (page: Page) => new URL(page.url()).searchParams;
const id = '82000000-0000-4000-8000-000000000001';
const request = {
  id,
  actionType: 'refund',
  amountIrR: '9007199254740993',
  initiatorId: 'finance',
  initiatorUsername: 'Finance',
  reason: 'Evidence checked',
  status: 'pending',
  reviewerId: null,
  reviewerUsername: null,
  reviewReason: null,
  details: null,
};
const from = '2026-09-01T07:00:15.123Z',
  before = '2026-09-03T07:00:00.000Z';
async function shell(page: Page, locale: 'en' | 'fa', dark: boolean) {
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
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (locale === 'fa' && project === 'mobile-safari')
    await page.screenshot({
      path: `/tmp/barghsa-decision-query-${domain}-${dark ? 'dark' : 'light'}.png`,
    });
}
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true]) {
    test(`approval URLs retain queue pages and linked request context (${locale}, ${dark})`, async ({
      page,
    }, info) => {
      await shell(page, locale, dark);
      const word = (key: string) => t(`admin.approvals.${key}`, locale);
      await page.route('**/api/admin/config/dual-approval-threshold', (r) =>
        r.fulfill({ json: { thresholdIrR: 100000 } })
      );
      let fail = true,
        denied = false;
      const reads: URL[] = [],
        writes: string[] = [];
      await page.route('**/api/admin/approval-requests**', (r) => {
        const url = new URL(r.request().url());
        if (r.request().method() !== 'GET') {
          writes.push(url.pathname);
          return r.fulfill({ status: 500, json: {} });
        }
        reads.push(url);
        if (denied) return r.fulfill({ status: 403, json: {} });
        if (url.pathname.endsWith(id)) return r.fulfill({ json: request });
        const offset = Number(url.searchParams.get('offset'));
        if (offset === 50 && fail) return r.fulfill({ status: 503, json: {} });
        return r.fulfill({
          json: Array.from({ length: offset === 50 ? 1 : 26 }, (_, i) => ({
            ...request,
            id: `82000000-0000-4000-8000-${String(offset + i + 1).padStart(12, '0')}`,
            status: url.searchParams.get('status'),
            reason: `Queue evidence ${offset + i}`,
          })),
        });
      });
      await page.goto('/admin/approval-requests?page=2');
      await expect(page.getByText('Queue evidence 25', { exact: true })).toBeVisible();
      expect(Object.fromEntries(reads.at(-1)!.searchParams)).toEqual({
        status: 'pending',
        limit: '26',
        offset: '25',
      });
      const reason = page.getByRole('textbox', { name: word('rejectReason'), exact: true }).first();
      await reason.fill('LOCAL-DRAFT');
      await page.getByRole('button', { name: word('next'), exact: true }).click();
      await expect(page.getByRole('button', { name: word('retry'), exact: true })).toBeVisible();
      await expect(reason).toHaveValue('LOCAL-DRAFT');
      await expect(page.getByText('Queue evidence 25', { exact: true })).toBeVisible();
      expect(params(page).get('page')).toBe('3');
      expect(page.url()).not.toContain('LOCAL-DRAFT');
      const failed = reads.at(-1)!.search;
      fail = false;
      await page.getByRole('button', { name: word('retry'), exact: true }).click();
      await expect(page.getByText('Queue evidence 50', { exact: true })).toBeVisible();
      expect(reads.at(-1)!.search).toBe(failed);
      await page.reload();
      await expect(page.getByText('Queue evidence 50', { exact: true })).toBeVisible();
      expect(params(page).get('page')).toBe('3');
      await page.goBack();
      await expect(page.getByText('Queue evidence 25', { exact: true })).toBeVisible();
      await page.goForward();
      await expect(page.getByText('Queue evidence 50', { exact: true })).toBeVisible();
      await page.locator('#approval-status').selectOption('approved');
      await expect(page.locator('#approval-status')).toHaveValue('approved');
      await expect(page.getByText('Queue evidence 0', { exact: true })).toBeVisible();
      expect(params(page).get('status')).toBe('approved');
      expect(params(page).has('page')).toBe(false);
      await expect(page.getByRole('button', { name: word('approve'), exact: true })).toHaveCount(0);
      await page.goBack();
      await expect(page.getByText('Queue evidence 50', { exact: true })).toBeVisible();
      await inspect(page, locale, info.project.name, 'approvals', dark);
      await page.goto(`/admin/approval-requests?status=approved&page=2&requestId=${id}`);
      await expect(page.getByText(word('linkedRequest'), { exact: false })).toBeVisible();
      expect(reads.at(-1)!.pathname).toBe(`/api/admin/approval-requests/${id}`);
      await page.getByRole('link', { name: word('backToQueue'), exact: true }).click();
      await expect(page.locator('#approval-status')).toHaveValue('approved');
      await expect(page.getByText('Queue evidence 25', { exact: true })).toBeVisible();
      expect(params(page).get('page')).toBe('2');
      await page.goBack();
      await page.getByRole('button', { name: word('approve'), exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.goForward();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(writes).toEqual([]);
      denied = true;
      await page.getByRole('button', { name: word('refresh'), exact: true }).click();
      await expect(page.getByRole('alert')).toContainText(word('loadForbidden'));
      await expect(page.getByText('Queue evidence 25', { exact: true })).toHaveCount(0);
    });
    test(`reconciliation URLs restore exact dates and independent filter drafts (${locale}, ${dark})`, async ({
      page,
    }, info) => {
      await shell(page, locale, dark);
      await page.route('**/api/user/settings/timezone', (r) =>
        r.fulfill({ json: { timezone: 'America/Los_Angeles' } })
      );
      const word = (key: string) => t(`admin.reconciliation.${key}`, locale);
      let fail = true,
        denied = false;
      const reads: URL[] = [],
        writes: string[] = [];
      await page.route('**/api/admin/reconciliation/items**', (r) => {
        const url = new URL(r.request().url());
        if (url.pathname.endsWith('/access'))
          return r.fulfill({ json: { canView: !denied, canResolve: true } });
        if (r.request().method() !== 'GET') {
          writes.push(url.pathname);
          return r.fulfill({ status: 500, json: {} });
        }
        reads.push(url);
        const offset = Number(url.searchParams.get('offset'));
        if (offset === 50 && fail) return r.fulfill({ status: 503, json: {} });
        return r.fulfill({
          json: Array.from({ length: offset === 50 ? 1 : 25 }, (_, i) => ({
            ...reconciliationItem,
            id: `10000000-0000-4000-8000-${String(offset + i + 1).padStart(12, '0')}`,
            description: `Exception ${offset + i}`,
          })),
        });
      });
      const query = new URLSearchParams({
        severity: 'high',
        createdFrom: from,
        createdBefore: before,
        page: '2',
      });
      await page.goto(`/admin/reconciliation?${query}`);
      await expect(page.getByRole('button', { name: 'Exception 25', exact: true })).toBeVisible();
      await expect(page.locator('#rex-from')).toHaveValue('2026-09-01T00:00');
      expect(Object.fromEntries(reads.at(-1)!.searchParams)).toEqual({
        status: 'open',
        severity: 'high',
        createdFrom: from,
        createdBefore: before,
        limit: '25',
        offset: '25',
      });
      const initial = reads.length;
      await page.locator('#rex-severity').selectOption('critical');
      expect(reads).toHaveLength(initial);
      expect(params(page).get('severity')).toBe('high');
      await page.getByRole('button', { name: word('next'), exact: true }).click();
      await expect(page.getByRole('button', { name: word('retry'), exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Exception 25', exact: true })).toBeVisible();
      await expect(page.locator('#rex-severity')).toHaveValue('critical');
      const failed = reads.at(-1)!.search;
      fail = false;
      await page.getByRole('button', { name: word('retry'), exact: true }).click();
      await expect(page.getByRole('button', { name: 'Exception 50', exact: true })).toBeVisible();
      expect(reads.at(-1)!.search).toBe(failed);
      await page.reload();
      await expect(page.locator('#rex-severity')).toHaveValue('high');
      await expect(page.locator('#rex-from')).toHaveValue('2026-09-01T00:00');
      await page.getByRole('button', { name: word('apply'), exact: true }).click();
      await expect(page.getByRole('button', { name: 'Exception 0', exact: true })).toBeVisible();
      expect(params(page).has('page')).toBe(false);
      expect(reads.at(-1)!.searchParams.get('createdFrom')).toBe(from);
      await page.goBack();
      await expect(page.getByRole('button', { name: 'Exception 50', exact: true })).toBeVisible();
      await page.goForward();
      await expect(page.getByRole('button', { name: 'Exception 0', exact: true })).toBeVisible();
      await page.locator('#rex-status').selectOption('');
      await page.locator('#rex-severity').selectOption('');
      await page.locator('#rex-from').fill('');
      await page.locator('#rex-before').fill('');
      await page.getByRole('button', { name: word('apply'), exact: true }).click();
      await expect.poll(() => params(page).get('status')).toBe('all');
      await expect(page.getByRole('button', { name: 'Exception 0', exact: true })).toBeVisible();
      await expect
        .poll(() => Object.fromEntries(reads.at(-1)!.searchParams))
        .toEqual({
          limit: '25',
          offset: '0',
        });
      await page.goBack();
      await expect(page.locator('#rex-from')).toHaveValue('2026-09-01T00:00');
      await expect(page.getByRole('button', { name: 'Exception 0', exact: true })).toBeVisible();
      await inspect(page, locale, info.project.name, 'reconciliation', dark);
      await page.getByRole('button', { name: 'Exception 0', exact: true }).click();
      await page.locator('#rex-note').fill('LOCAL-DRAFT');
      expect(page.url()).not.toContain('LOCAL-DRAFT');
      await page.getByRole('button', { name: word('resolve'), exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.goBack();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.locator('#rex-note')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Exception 50', exact: true })).toBeVisible();
      expect(writes).toEqual([]);
      denied = true;
      await page.getByRole('button', { name: word('refresh'), exact: true }).click();
      await expect(page.getByRole('alert')).toContainText(word('forbidden'));
      await expect(page.getByRole('table')).toHaveCount(0);
    });
  }
