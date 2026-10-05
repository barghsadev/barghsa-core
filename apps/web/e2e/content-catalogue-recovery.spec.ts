import { test, expect } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/admin-ui';
import { t as appText } from '@barghsa/i18n/app';
import { adminTosText } from '../src/pages/admin-tos-text';
import { notificationTemplate, termsVersion } from '../src/test/content-catalogue-fixtures';
test.use({ viewport: { width: 390, height: 844 } });
for (const domain of ['templates', 'terms'] as const)
  for (const locale of ['en', 'fa'] as const)
    for (const theme of ['light', 'dark'] as const) {
      test(`${domain} publishing catalogue recovery (${locale}, ${theme})`, async ({ page }) => {
        await crmShell(page, locale);
        await page.route('**/api/public/branding/config', (route) =>
          route.fulfill({
            json: {
              appTitle: 'Publishing',
              appTitleFa: 'انتشار',
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
        const tos = adminTosText(locale),
          nt = (key: string) => t(`admin.notifications.${key}`, locale);
        let failed = false,
          changed = false,
          denied = false,
          nextRevision = false;
        const row = () =>
          domain === 'templates'
            ? {
                ...notificationTemplate(),
                channel: 'in_app',
                subject: null,
                bodyTemplate: changed ? 'Fresh text' : 'Recovery body',
                updatedAt: changed ? '2026-10-01T01:00:00Z' : notificationTemplate().updatedAt,
              }
            : {
                ...termsVersion(),
                contentEn: changed ? 'Fresh text' : 'Terms',
                revision: (nextRevision ? 'c' : changed ? 'b' : 'a').repeat(64),
              };
        const endpoint =
          domain === 'templates' ? '/api/admin/notifications/templates' : '/api/admin/tos/versions';
        await page.route(`**${endpoint}**`, (route) =>
          route.request().method() !== 'GET'
            ? route.fulfill({ status: 403, json: { requiresStepUp: true } })
            : route.fulfill({
                status: denied ? 403 : failed ? 503 : 200,
                json: new URL(route.request().url()).pathname === endpoint ? [row()] : row(),
              })
        );
        await page.goto(domain === 'templates' ? '/admin/notifications' : '/admin/tos');
        const refresh = domain === 'templates' ? nt('refresh') : tos.refresh;
        const history =
          domain === 'terms'
            ? page.getByRole('list', { name: tos.history, exact: true })
            : page.getByRole('list', { name: nt('catalogue'), exact: true });
        await expect(history).toBeVisible();
        await history
          .getByRole('button', {
            name: domain === 'templates' ? nt('edit') : tos.edit,
            exact: true,
          })
          .click();
        const input =
          domain === 'templates'
            ? page.locator('#notification-template-bodyTemplate')
            : page.getByRole('textbox', { name: tos.english, exact: true });
        await input.fill('Local text');
        const form = page.locator('form').filter({ has: input });
        failed = true;
        await page.getByRole('button', { name: refresh, exact: true }).click();
        await expect(form.locator('button[type=submit]')).toBeDisabled();
        if (domain === 'templates') await expect(input).toHaveValue('Local text');
        else await expect(input).toContainText('Local text');
        failed = false;
        await page.getByRole('button', { name: refresh, exact: true }).click();
        await expect(form.locator('button[type=submit]')).toBeEnabled();
        if (domain === 'templates') {
          await form.locator('button[type=submit]').click();
          const dialog = page.getByRole('dialog'),
            confirm = dialog.locator('button[type=submit]');
          await dialog.locator('input[type=password]').fill('synthetic-password');
          failed = true;
          await dialog.getByRole('button', { name: refresh, exact: true }).click();
          await expect(confirm).toBeDisabled();
          await expect(dialog.locator('input[type=password]')).toHaveValue('synthetic-password');
          failed = false;
          await dialog.getByRole('button', { name: refresh, exact: true }).click();
          await expect(confirm).toBeEnabled();
          expect(
            (await new AxeBuilder({ page }).include('[role=dialog]').analyze()).violations
          ).toEqual([]);
          await dialog.locator('input[type=password]').focus();
          await page.keyboard.press('Tab');
          await expect(
            dialog.getByRole('button', { name: appText('team.cancel', locale), exact: true })
          ).toBeFocused();
          changed = true;
          await dialog.getByRole('button', { name: refresh, exact: true }).click();
          await expect(dialog).toHaveCount(0);
          await expect(input).toHaveValue('Local text');
          await page.getByRole('button', { name: nt('reset'), exact: true }).click();
          await expect(input).toHaveValue('Fresh text');
        } else {
          changed = true;
          await page.getByRole('button', { name: refresh, exact: true }).click();
          await expect(input).toContainText('Local text');
          await expect(form.locator('button[type=submit]')).toBeDisabled();
          await page.getByRole('button', { name: tos.reloadDraft, exact: true }).click();
          await expect(input).toContainText('Fresh text');
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true
        );
        for (const node of await form
          .locator('input,select,textarea,button,[contenteditable=true]')
          .all()) {
          const box = await node.boundingBox();
          if (box) {
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(391);
          }
        }
        expect(
          (await new AxeBuilder({ page }).include('[data-slot=list-page]').analyze()).violations
        ).toEqual([]);
        await page.screenshot({ path: `/tmp/barghsa-content-${domain}-${locale}-${theme}.png` });
        await form
          .getByRole('button', {
            name: domain === 'templates' ? nt('cancel') : tos.cancel,
            exact: true,
          })
          .click();
        if (domain === 'terms') {
          await history.getByRole('button', { name: tos.publish, exact: true }).click();
          const preview = page.getByRole('region', { name: tos.publishTitle, exact: true });
          await expect(
            preview.getByRole('button', { name: tos.publish, exact: true })
          ).toBeEnabled();
          failed = true;
          await page.getByRole('button', { name: refresh, exact: true }).click();
          await expect(
            preview.getByRole('button', { name: tos.publish, exact: true })
          ).toBeDisabled();
          failed = false;
          await page.getByRole('button', { name: refresh, exact: true }).click();
          await expect(
            preview.getByRole('button', { name: tos.publish, exact: true })
          ).toBeEnabled();
          nextRevision = true;
          await page.getByRole('button', { name: refresh, exact: true }).click();
          await expect(preview).toHaveCount(0);
        }
        const keyboardTarget =
          domain === 'terms'
            ? history.getByRole('button', { name: tos.view, exact: true })
            : history.getByRole('button', { name: nt('edit'), exact: true });
        await keyboardTarget.focus();
        await page.keyboard.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
        await expect(keyboardTarget).toBeFocused();
        denied = true;
        await page.getByRole('button', { name: refresh, exact: true }).click();
        await expect(history).toHaveCount(0);
        await expect(
          page
            .getByRole('alert')
            .filter({ hasText: domain === 'templates' ? nt('denied') : tos.denied })
        ).toBeVisible();
        denied = false;
        await page.getByRole('button', { name: refresh, exact: true }).click();
        await expect(history).toBeVisible();
      });
    }
