import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/admin-ui';
import { t as appText } from '@barghsa/i18n/app';
import { electricityLimits } from '../src/test/contract-settings-fixtures';
import { crmShell } from './crm-shell-fixture';
import { test, expect } from './coverage-fixture';

for (const width of [390, 1440]) {
  test.describe(`settings at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });
    for (const locale of ['en', 'fa'] as const) {
      for (const darkMode of [false, true]) {
        test(`navigation and verified section save (${locale}, dark=${darkMode})`, async ({
          page,
        }, info) => {
          await crmShell(page, locale);
          await page.route('**/api/public/branding/config', (route) =>
            route.fulfill({
              json: {
                appTitle: 'Settings',
                appTitleFa: 'تنظیمات',
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
          await page.route('**/api/admin/config/profile-verification-mode', (route) =>
            route.fulfill({ json: { mode: 'MANUAL', draft: null, version: 0 } })
          );
          await page.route('**/api/admin/config/otp', (route) =>
            route.fulfill({ json: { ttlSeconds: 300, version: 0 } })
          );
          let config = { ...electricityLimits };
          const writes: unknown[] = [];
          await page.route('**/api/admin/config/contract-electricity-limits', (route) => {
            if (route.request().method() === 'GET') return route.fulfill({ json: config });
            writes.push(route.request().postDataJSON());
            if (writes.length === 1) return route.fulfill({ json: {} });
            config = { ...config, leadTimeDays: 14 };
            return route.fulfill({ json: config });
          });
          await page.goto('/admin/contract-limits');
          const layout = page.getByTestId('admin-settings-layout');
          const select = layout.getByRole('combobox');
          const nav = layout.getByRole('navigation', {
            name: t('admin.settings.navigation', locale),
          });
          if (width < 1024) {
            await expect(select).toBeVisible();
            await expect(select.locator('optgroup')).toHaveCount(12);
            await expect(select.locator('option')).toHaveCount(25);
            await expect(nav).toBeHidden();
            await select.focus();
            await expect(select).toBeFocused();
            await select.selectOption('/admin/verification');
          } else {
            await expect(nav).toBeVisible();
            await expect(select).toBeHidden();
            await expect(nav.locator('[aria-current="page"]')).toHaveAttribute(
              'href',
              '/admin/contract-limits'
            );
            await nav.locator('a[href="/admin/verification"]').click();
          }
          await expect(page).toHaveURL(/\/admin\/verification$/);
          await expect(layout.locator(':scope > div > [role=region]')).toBeFocused();
          if (width < 1024) await select.selectOption('/admin/contract-limits');
          else await nav.locator('a[href="/admin/contract-limits"]').click();
          await expect(page).toHaveURL(/\/admin\/contract-limits$/);
          const lead = page.locator('#contract-limit-leadTimeDays');
          await lead.fill('14');
          await page
            .getByRole('button', { name: t('admin.contractLimits.save', locale), exact: true })
            .click();
          const dialog = page.getByRole('dialog');
          const confirm = dialog.getByRole('button', {
            name: appText('team.confirm', locale),
            exact: true,
          });
          await expect(lead).toBeDisabled();
          await confirm.click();
          await expect(dialog.getByRole('alert')).toBeVisible();
          await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
          await expect(lead).toHaveValue('14');
          await confirm.click();
          await expect(dialog).toHaveCount(0);
          await expect(page.locator('[data-sonner-toast]')).toContainText(
            t('admin.contractLimits.saved', locale)
          );
          expect(writes).toEqual(
            Array(2).fill({
              max_quantity_increase_percent: config.maxQuantityIncreasePercent,
              max_contract_duration_months: config.maxContractDuration,
              lead_time_days: 14,
            })
          );
          await page.reload();
          await expect(lead).toHaveValue('14');
          await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
          expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
          ).toBe(true);
          if (locale === 'fa' && info.project.name === 'mobile-safari')
            await page.screenshot({
              path: `/tmp/barghsa-admin-settings-${width}-${darkMode ? 'dark' : 'light'}.png`,
              fullPage: true,
            });
          await page.goto('/admin/tickets');
          await expect(page.getByTestId('admin-settings-layout')).toHaveCount(0);
          await expect(page.locator('#admin-content')).toBeVisible();
        });
      }
    }
  });
}
