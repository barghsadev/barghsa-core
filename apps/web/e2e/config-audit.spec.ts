import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/admin-ui';
import { brandingText } from '@barghsa/i18n/branding';
import { configAuditPage, configAuditCursor } from '../src/test/config-audit-fixtures';
import { publishedBrand } from '../src/test/branding-settings-fixtures';
import { crmShell } from './crm-shell-fixture';
import { test, expect } from './coverage-fixture';
test.use({ viewport: { width: 390, height: 844 } });
for (const scope of ['branding', 'otp', 'service-response-targets'] as const)
  for (const locale of ['en', 'fa'] as const)
    for (const darkMode of [false, true])
      test(`settings audit recovery (${scope}, ${locale}, dark=${darkMode})`, async ({
        page,
      }, info) => {
        await crmShell(page, locale);
        await page.route('**/api/public/branding/config', (route) =>
          route.fulfill({ json: { ...publishedBrand.config, darkMode } })
        );
        await page.route('**/api/admin/branding/config', (route) =>
          route.fulfill({ json: publishedBrand })
        );
        await page.route('**/api/admin/branding/configs', (route) =>
          route.fulfill({ json: [publishedBrand] })
        );
        await page.route('**/api/admin/config/otp', (route) =>
          route.fulfill({ json: { ttlSeconds: 300, version: 1 } })
        );
        await page.route('**/api/admin/config/profile-verification-mode', (route) =>
          route.fulfill({ json: { mode: 'MANUAL', draft: null, version: 0 } })
        );
        await page.route('**/api/admin/config/service-response-targets', (route) =>
          route.fulfill({ json: { ticket: 24, verification_case: null, consultation: null } })
        );
        const calls: string[] = [],
          mutations: string[] = [];
        let failedCursor = true,
          bad = false,
          denied = false;
        await page.route('**/api/admin/config/audit?**', (route) => {
          const url = new URL(route.request().url());
          calls.push(url.search);
          if (route.request().method() !== 'GET') mutations.push(route.request().method());
          if (denied) return route.fulfill({ status: 403, json: {} });
          if (bad) return route.fulfill({ json: { ...configAuditPage(scope), scope: 'foreign' } });
          if (url.searchParams.has('cursor'))
            return route.fulfill({
              status: failedCursor ? 503 : 200,
              json: {
                scope,
                items: [
                  {
                    ...configAuditPage(scope).items[0]!,
                    id: '01900000-0000-7000-8000-000000000002',
                  },
                ],
                nextCursor: null,
              },
            });
          return route.fulfill({ json: configAuditPage(scope) });
        });
        await page.goto(
          scope === 'branding'
            ? '/admin/branding'
            : scope === 'otp'
              ? '/admin/verification'
              : '/admin/service-targets'
        );
        if (scope === 'branding')
          await page
            .getByRole('button', { name: t('admin.settings.edit', locale), exact: true })
            .click();
        const input = page.locator(
          scope === 'branding'
            ? '#adminbrandingconfig-field-2'
            : scope === 'otp'
              ? '#otp-lifetime'
              : '#target-ticket'
        );
        await input.fill(scope === 'branding' ? 'Pending local title' : '120');
        const draft = await input.inputValue();
        const audit = page.getByTestId('config-audit'),
          word = (key: string) => t(`admin.audit.${key}`, locale);
        expect(calls).toEqual([]);
        const show = audit.getByRole('button', { name: word('show'), exact: true });
        await show.focus();
        await show.press('Enter');
        await expect(audit.locator('li')).toHaveCount(1);
        const summary = audit.locator('summary').first();
        await summary.focus();
        await summary.press('Enter');
        await expect(audit.locator('details').first()).toHaveAttribute('open', '');
        await expect(audit).toContainText('staff-auditor');
        await expect(audit).toContainText(word('previous'));
        await expect(audit).toContainText(word('current'));
        await expect(audit.locator('script')).toHaveCount(0);
        await audit.getByRole('button', { name: word('more'), exact: true }).click();
        await expect(audit.getByRole('alert')).toContainText(word('error'));
        await expect(audit.locator('details').first()).toHaveAttribute('open', '');
        const failed = calls.at(-1);
        expect(failed).toContain(`cursor=${configAuditCursor}`);
        failedCursor = false;
        await audit.getByRole('button', { name: word('retry'), exact: true }).click();
        await expect(audit.locator('li')).toHaveCount(2);
        expect(calls.at(-1)).toBe(failed);
        bad = true;
        await audit.getByRole('button', { name: word('refresh'), exact: true }).click();
        await expect(audit.getByRole('alert')).toContainText(word('error'));
        await expect(audit.locator('li')).toHaveCount(2);
        await expect(input).toHaveValue(draft);
        bad = false;
        await audit.getByRole('button', { name: word('retry'), exact: true }).click();
        await expect(audit.getByRole('alert')).toHaveCount(0);
        await expect(audit.locator('li')).toHaveCount(1);
        expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true
        );
        if (scope === 'branding' && locale === 'fa' && info.project.name === 'mobile-safari')
          await audit.screenshot({
            path: `/tmp/barghsa-config-audit-${darkMode ? 'dark' : 'light'}.png`,
          });
        expect(mutations).toEqual([]);
        denied = true;
        await audit.getByRole('button', { name: word('refresh'), exact: true }).click();
        await expect(audit).toHaveCount(0);
        await expect(page.locator('main')).not.toContainText('staff-auditor');
        if (scope === 'branding')
          await expect(
            page.getByRole('textbox', { name: brandingText('appTitle', locale), exact: true })
          ).toHaveCount(0);
        else if (scope === 'otp') await expect(input).toHaveValue('');
        else await expect(input).toHaveCount(0);
        expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
      });
