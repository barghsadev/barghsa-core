import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/terms';
for (const locale of ['fa', 'en'] as const) {
  for (const darkMode of [false, true]) {
    test(`terms status and review remain readable (${locale}, dark=${darkMode})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript((value) => {
        const apply = () => {
          document.documentElement.lang = value;
        };
        if (document.documentElement) apply();
        new MutationObserver(apply).observe(document, { childList: true });
      }, locale);
      let statusReady = false,
        contentReady = false;
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/public/branding/config', (route) =>
        route.fulfill({
          json: {
            appTitle: 'Terms theme',
            slogan: '',
            primaryColor: '#777777',
            secondaryColor: '#64748b',
            accentColor: '#f59e0b',
            logoUrl: null,
            faviconUrl: null,
            darkMode,
          },
        })
      );
      await page.route('**/api/user/settings/timezone', (route) =>
        route.fulfill({ json: { timezone: 'Asia/Tehran' } })
      );
      await page.route('**/api/admin/finance/vat**', (route) => route.fulfill({ json: [] }));
      await page.route('**/api/auth/user', (route) =>
        route.fulfill(
          statusReady
            ? { json: { userId: 'owner', requiresTosAcceptance: true } }
            : { status: 503, json: {} }
        )
      );
      await page.route('**/api/tos/current?*', (route) =>
        route.fulfill(
          contentReady
            ? {
                json: {
                  id: 'terms-v1',
                  versionId: 'v1',
                  content: locale === 'fa' ? 'متن شرایط قابل مطالعه' : 'Readable terms content',
                  updatedAt: '2026-09-01T00:00:00Z',
                  publishedAt: '2026-09-01T00:00:00Z',
                },
              }
            : { status: 503, json: {} }
        )
      );
      await page.goto('/admin/vat');
      const failed = page
        .getByRole('status')
        .filter({ hasText: t('tos.banner.checkFailed', locale) });
      await expect(failed).toBeVisible();
      expect(
        (await new AxeBuilder({ page }).withRules(['color-contrast']).analyze()).violations
      ).toEqual([]);
      statusReady = true;
      await failed.getByRole('button', { name: t('tos.banner.retry', locale) }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(t('tos.page.error', locale));
      expect(
        (await new AxeBuilder({ page }).withRules(['color-contrast']).analyze()).violations
      ).toEqual([]);
      await expect(
        dialog.getByRole('button', { name: t('tos.modal.accept', locale), exact: true })
      ).toBeDisabled();
      await page.keyboard.press('Escape');
      contentReady = true;
      await page.getByRole('button', { name: t('tos.banner.review', locale), exact: true }).click();
      await expect(dialog).toContainText(
        locale === 'fa' ? 'متن شرایط قابل مطالعه' : 'Readable terms content'
      );
      const close = dialog.getByRole('button', { name: t('tos.modal.close', locale), exact: true });
      const closeBox = (await close.boundingBox())!;
      const titleBox = (await dialog.getByRole('heading').boundingBox())!;
      if (locale === 'fa') expect(closeBox.x + closeBox.width).toBeLessThanOrEqual(titleBox.x);
      else expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(closeBox.x);
      await expect(
        dialog.getByRole('button', { name: t('tos.modal.accept', locale), exact: true })
      ).toBeEnabled();
      expect(
        (await new AxeBuilder({ page }).withRules(['color-contrast']).analyze()).violations
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      await page.screenshot({ path: `/tmp/r03-terms-${locale}-${darkMode}.png`, fullPage: true });
    });
  }
}
