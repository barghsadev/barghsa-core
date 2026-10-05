import { test, expect, type Page } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/admin-ui';
import { staffAccess, staffUser, staffRoles } from '../src/test/staff-directory-fixtures';
import { catalogueRole } from '../src/test/policy-catalogue-fixtures';
test.use({ viewport: { width: 390, height: 844 } });
const params = (page: Page) => new URL(page.url()).searchParams;
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
      path: `/tmp/barghsa-staff-query-${domain}-${dark ? 'dark' : 'light'}.png`,
    });
}
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true]) {
    test(`directory links retain exact page recovery and invalidate old confirmations (${locale}, ${dark})`, async ({
      page,
    }, info) => {
      await shell(page, locale, dark);
      const word = (key: string) => t(`admin.staff.${key}`, locale);
      let fail = true,
        denied = false;
      const reads: URL[] = [];
      await page.route('**/api/admin/staff-access', (route) =>
        route.fulfill({ json: staffAccess })
      );
      await page.route('**/api/admin/staff-role-options', (route) =>
        route.fulfill({ json: staffRoles })
      );
      await page.route('**/api/admin/staff?*', (route) => {
        const url = new URL(route.request().url());
        reads.push(url);
        const last = url.searchParams.get('offset') === '50';
        return route.fulfill({
          status: denied ? 403 : last && fail ? 503 : 200,
          json: { items: [{ ...staffUser, firstName: last ? 'Third' : 'Second' }], total: 51 },
        });
      });
      await page.goto('/admin/users?page=2');
      await expect(page.locator('table:visible, ol[role=list]:visible')).toContainText(
        'Second Alice'
      );
      expect(Object.fromEntries(reads.at(-1)!.searchParams)).toEqual({ limit: '25', offset: '25' });
      await page.getByRole('button', { name: word('create'), exact: true }).click();
      await page.locator('#staff-firstName').fill('LOCAL-DRAFT');
      await page.getByRole('button', { name: word('next'), exact: true }).click();
      await expect(page.getByRole('button', { name: word('retry'), exact: true })).toBeVisible();
      await expect(page.locator('table:visible, ol[role=list]:visible')).toContainText(
        'Second Alice'
      );
      await expect(page.locator('#staff-firstName')).toHaveValue('LOCAL-DRAFT');
      expect(params(page).get('page')).toBe('3');
      expect(page.url()).not.toContain('LOCAL-DRAFT');
      const failed = reads.at(-1)!.search;
      fail = false;
      await page.getByRole('button', { name: word('retry'), exact: true }).click();
      await expect(page.locator('table:visible, ol[role=list]:visible')).toContainText(
        'Third Alice'
      );
      expect(reads.at(-1)!.search).toBe(failed);
      await expect(page.locator('#staff-firstName')).toHaveValue('LOCAL-DRAFT');
      await page.reload();
      await expect(page.locator('table:visible, ol[role=list]:visible')).toContainText(
        'Third Alice'
      );
      expect(reads.at(-1)!.search).toBe(failed);
      await expect(page.locator('#staff-firstName')).toHaveCount(0);
      await page.goBack();
      await expect(page.locator('table:visible, ol[role=list]:visible')).toContainText(
        'Second Alice'
      );
      await page.goForward();
      await expect(page.locator('table:visible, ol[role=list]:visible')).toContainText(
        'Third Alice'
      );
      await page.getByRole('button', { name: word('disable'), exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.goBack();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.locator('table:visible, ol[role=list]:visible')).toContainText(
        'Second Alice'
      );
      await page.getByRole('button', { name: word('previous'), exact: true }).click();
      await expect.poll(() => reads.at(-1)?.searchParams.get('offset')).toBe('0');
      expect(params(page).has('page')).toBe(false);
      await inspect(page, locale, info.project.name, 'directory', dark);
      denied = true;
      await page.getByRole('button', { name: word('next'), exact: true }).click();
      await expect(page.locator('table:visible, ol[role=list]:visible')).toHaveCount(0);
      await expect(page.getByRole('alert')).toContainText(word('forbidden'));
    });
    test(`role filters restore module comparison through reload and navigation (${locale}, ${dark})`, async ({
      page,
    }, info) => {
      await shell(page, locale, dark);
      const word = (key: string) => t(`admin.roles.${key}`, locale);
      let failed = false,
        denied = false;
      let reads = 0;
      await page.route('**/api/admin/roles', (route) => {
        reads++;
        return route.fulfill({
          status: denied ? 403 : failed ? 503 : 200,
          json: [
            catalogueRole,
            {
              ...catalogueRole,
              roleId: 'write',
              name: 'Finance writer',
              permissions: ['finance:write', 'tickets:read'],
            },
            { ...catalogueRole, roleId: 'admin', permissions: ['*'] },
          ],
        });
      });
      await page.goto('/admin/roles?module=finance');
      const module = page.getByRole('combobox', { name: word('compare.module'), exact: true });
      await expect(module).toHaveValue('finance');
      const rows = page.locator('table:visible tbody tr, ol[role=list]:visible > li');
      await expect(rows).toHaveCount(3);
      for (const [index, grants] of [
        [0, [true, false]],
        [1, [false, true]],
        [2, [true, true]],
      ] as const) {
        for (const [column, checked] of grants.entries()) {
          await expect(rows.nth(index).getByRole('checkbox').nth(column)).toBeDisabled();
          await expect(rows.nth(index).getByRole('checkbox').nth(column)).toBeChecked({ checked });
        }
      }
      await page.reload();
      await expect(module).toHaveValue('finance');
      const count = reads;
      await module.selectOption('tickets');
      expect(params(page).get('module')).toBe('tickets');
      await expect(rows.first().getByRole('checkbox')).not.toBeChecked();
      expect(reads).toBe(count);
      await page.goBack();
      await expect(module).toHaveValue('finance');
      await page.goForward();
      await expect(module).toHaveValue('tickets');
      failed = true;
      await page
        .getByRole('button', { name: t('admin.jobs.refresh', locale), exact: true })
        .click();
      await expect(page.getByRole('alert')).toContainText(word('load.failed'));
      await expect(module).toHaveValue('tickets');
      failed = false;
      await page.getByRole('button', { name: word('retry'), exact: true }).click();
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(module).toHaveValue('tickets');
      await module.selectOption('');
      expect(params(page).has('module')).toBe(false);
      await expect(rows.first()).toContainText('invoices:read');
      await inspect(page, locale, info.project.name, 'roles', dark);
      denied = true;
      await page
        .getByRole('button', { name: t('admin.jobs.refresh', locale), exact: true })
        .click();
      await expect(page.locator('table:visible, ol[role=list]:visible')).toHaveCount(0);
    });
  }
