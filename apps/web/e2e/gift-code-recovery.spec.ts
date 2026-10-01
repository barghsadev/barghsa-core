import { test, expect } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/app';
import { tGift } from '@barghsa/i18n/gifts';
import { giftCode } from '../src/test/gift-code-fixtures';
test.use({ viewport: { width: 390, height: 844 } });
for (const locale of ['en', 'fa'] as const)
  for (const theme of ['light', 'dark'] as const) {
    test(`gift catalogue and editor recover (${locale}, ${theme})`, async ({ page }) => {
      await crmShell(page, locale);
      await page.route('**/api/public/branding/config', (route) =>
        route.fulfill({
          json: {
            appTitle: 'Gift codes',
            appTitleFa: 'کدهای تخفیف',
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
      const text = (key: string) => tGift(`admin.gifts.${key}`, locale);
      let olderFailed = true,
        short = false,
        listFailed = false,
        detailFailed = false,
        changed = false,
        denied = false;
      const cursors: string[] = [];
      const row = () => ({
        ...giftCode(),
        discountValue: changed ? '3000' : '1000',
        updatedAt: changed ? '2026-10-01T00:00:00Z' : giftCode().updatedAt,
      });
      await page.route('**/api/admin/promotions/gift-codes**', async (route) => {
        const path = new URL(route.request().url());
        if (route.request().method() !== 'GET')
          return route.fulfill({ status: 403, json: { requiresStepUp: true } });
        if (path.pathname.endsWith('/stats'))
          return route.fulfill({
            status: denied ? 403 : detailFailed ? 503 : 200,
            json: { code: row(), perProfile: [], recentRedemptions: [] },
          });
        if (path.searchParams.has('before')) {
          cursors.push(path.searchParams.get('before')!);
          return route.fulfill({
            status: olderFailed ? 503 : 200,
            json: olderFailed ? {} : [giftCode(49), giftCode(50)],
          });
        }
        return route.fulfill({
          status: denied ? 403 : listFailed ? 503 : 200,
          json: short ? [row()] : Array.from({ length: 50 }, (_, i) => giftCode(i)),
        });
      });
      await page.goto('/admin/gift-codes');
      await expect(
        page.getByRole('button', { name: `${text('edit')} CODE00`, exact: true })
      ).toBeVisible();
      await page.getByRole('button', { name: text('loadMore'), exact: true }).click();
      await expect(page.getByRole('alert')).toContainText(text('moreError'));
      olderFailed = false;
      await page.getByRole('button', { name: text('loadMore'), exact: true }).click();
      await expect(
        page.getByRole('button', { name: `${text('edit')} CODE50`, exact: true })
      ).toBeVisible();
      expect(cursors).toHaveLength(2);
      expect(cursors[0]).toBe(cursors[1]);
      short = true;
      await page.getByRole('button', { name: text('refresh'), exact: true }).click();
      await expect(
        page.getByRole('button', { name: `${text('edit')} CODE50`, exact: true })
      ).toHaveCount(0);
      await page.getByRole('button', { name: `${text('edit')} CODE00`, exact: true }).click();
      const input = page.locator('#gift-value'),
        form = page.getByRole('form', { name: text('editor') });
      await input.fill('2222');
      detailFailed = true;
      await page.getByRole('button', { name: text('refreshStats'), exact: true }).click();
      await expect(form.locator('button[type=submit]')).toBeDisabled();
      await expect(input).toHaveValue('2222');
      detailFailed = false;
      await page.getByRole('button', { name: text('retry'), exact: true }).click();
      await form.locator('button[type=submit]').click();
      const dialog = page.getByRole('dialog'),
        confirm = dialog.locator('button[type=submit]');
      await confirm.click();
      await dialog.locator('input[type=password]').fill('synthetic-password');
      listFailed = true;
      await dialog.getByRole('button', { name: text('refresh'), exact: true }).click();
      await expect(confirm).toBeDisabled();
      await expect(dialog.locator('input[type=password]')).toHaveValue('synthetic-password');
      listFailed = false;
      await dialog.getByRole('button', { name: text('refresh'), exact: true }).click();
      await expect(confirm).toBeEnabled();
      expect(
        (await new AxeBuilder({ page }).include('[role=dialog]').analyze()).violations
      ).toEqual([]);
      await dialog.locator('input[type=password]').focus();
      await page.keyboard.press('Tab');
      await expect(
        dialog.getByRole('button', { name: t('team.cancel', locale), exact: true })
      ).toBeFocused();
      changed = true;
      await dialog.getByRole('button', { name: text('refresh'), exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(input).toHaveValue('2222');
      await expect(page.getByRole('button', { name: text('refresh'), exact: true })).toBeFocused();
      await page.getByRole('button', { name: text('reset'), exact: true }).click();
      await expect(input).toHaveValue('3000');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      for (const node of await form.locator('input,select,button').all()) {
        const box = await node.boundingBox();
        if (box) {
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(391);
        }
      }
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({ path: `/tmp/barghsa-gift-${locale}-${theme}.png` });
      denied = true;
      await page.getByRole('button', { name: text('refreshStats'), exact: true }).click();
      await expect(form).toHaveCount(0);
      await expect(page.getByRole('alert')).toContainText(text('denied'));
      denied = false;
      await page.getByRole('button', { name: text('refresh'), exact: true }).click();
      await expect(
        page.getByRole('button', { name: `${text('edit')} CODE00`, exact: true })
      ).toBeVisible();
    });
  }
