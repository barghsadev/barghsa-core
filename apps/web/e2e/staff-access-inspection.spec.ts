import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { t } from '@barghsa/i18n/admin-ui';
import { catalogueRole, effectivePermissions } from '../src/test/policy-catalogue-fixtures';
import { staffAccess, staffUser, staffRoles } from '../src/test/staff-directory-fixtures';
test.use({ viewport: { width: 390, height: 844 } });
for (const locale of ['en', 'fa'] as const)
  for (const theme of ['light', 'dark'] as const) {
    const text = (key: string) => t(`admin.roles.${key}`, locale);
    test(`staff access inspection retains verified results and clears denied access (${locale}, ${theme})`, async ({
      page,
    }, info) => {
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
            darkMode: theme === 'dark',
          },
        })
      );
      let allowed = true,
        mode = 'valid';
      const reads: string[] = [];
      await page.route('**/api/admin/staff-access', (route) =>
        route.fulfill({ json: { ...staffAccess, canEditRoles: allowed } })
      );
      await page.route('**/api/admin/staff-role-options', (route) =>
        route.fulfill({ json: staffRoles })
      );
      await page.route('**/api/admin/staff?*', (route) =>
        route.fulfill({ json: { items: [staffUser], total: 1 } })
      );
      await page.route('**/api/admin/users/*/effective-permissions', (route) => {
        reads.push(route.request().url());
        return route.fulfill(
          mode === 'failed'
            ? { status: 503, json: {} }
            : mode === 'denied'
              ? { status: 403, json: {} }
              : {
                  json: {
                    ...effectivePermissions,
                    userId: mode === 'foreign' ? 'foreign' : staffUser.userId,
                  },
                }
        );
      });
      await page.goto('/admin/users');
      const trigger = page.getByRole('button', { name: text('effective.inspect'), exact: true });
      await trigger.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('Finance Alice');
      await expect(dialog).toContainText('finance:read');
      expect(reads[0]).toContain(`/api/admin/users/${staffUser.userId}/effective-permissions`);
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark).*$/);
      expect(
        (await new AxeBuilder({ page }).include('[role=dialog]').analyze()).violations
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      if (locale === 'fa' && info.project.name === 'mobile-safari')
        await dialog.screenshot({ path: `/tmp/barghsa-staff-access-${theme}.png` });
      mode = 'failed';
      await dialog
        .getByRole('button', { name: t('admin.jobs.refresh', locale), exact: true })
        .click();
      await expect(dialog.getByRole('alert')).toContainText(text('effective.retained'));
      await expect(dialog).toContainText('finance:read');
      mode = 'foreign';
      await dialog.getByRole('button', { name: text('retry'), exact: true }).click();
      await expect(dialog).not.toContainText('foreign');
      await expect(dialog).toContainText('finance:read');
      await dialog.getByRole('button', { name: text('effective.close'), exact: true }).click();
      await expect(trigger).toBeFocused();
      mode = 'valid';
      await trigger.click();
      await expect(dialog).toContainText('finance:read');
      mode = 'denied';
      allowed = false;
      await dialog
        .getByRole('button', { name: t('admin.jobs.refresh', locale), exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toHaveCount(0);
      await expect(page.getByRole('table')).toContainText('Finance Alice');
      await expect(page.locator('main [data-testid=effective-permissions]')).toHaveCount(0);
    });
    test(`role module comparison shows read-only granted and ungranted permissions (${locale}, ${theme})`, async ({
      page,
    }) => {
      await crmShell(page, locale);
      await page.route('**/api/admin/roles', (route) =>
        route.fulfill({
          json: [
            catalogueRole,
            {
              ...catalogueRole,
              roleId: 'second',
              name: 'Payments reviewer',
              permissions: ['finance:write'],
            },
            { ...catalogueRole, roleId: 'all', name: 'All access', permissions: ['*'] },
          ],
        })
      );
      await page.goto('/admin/roles');
      const module = page.getByLabel(text('compare.module'), { exact: true });
      await module.selectOption('finance');
      const rows = page.locator('tbody tr');
      await expect(rows).toHaveCount(3);
      for (const [index, values] of [
        [0, [true, false]],
        [1, [false, true]],
        [2, [true, true]],
      ] as const) {
        for (const [column, checked] of values.entries()) {
          const checkbox = rows.nth(index).getByRole('checkbox').nth(column);
          await expect(checkbox).toBeDisabled();
          await expect(checkbox).toBeChecked({ checked });
        }
      }
      await page.evaluate(
        (value) => document.documentElement.classList.toggle('dark', value),
        theme === 'dark'
      );
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      await module.selectOption('');
      await expect(rows.first()).toContainText('invoices:read');
    });
  }
