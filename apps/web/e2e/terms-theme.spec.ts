import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/terms';
import { fullNavigation } from './navigation-fixture';
for (const locale of ['fa', 'en'] as const) {
  for (const darkMode of [false, true]) {
    test(`terms status and review remain readable (${locale}, dark=${darkMode})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 320, height: 520 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript((value) => {
        localStorage.setItem('barghsa.locale', value);
        const apply = () => {
          document.documentElement.lang = value;
        };
        if (document.documentElement) apply();
        new MutationObserver(apply).observe(document, { childList: true });
      }, locale);
      let sessionReads = 0;
      let statusReady = false,
        contentReady = false;
      const term = locale === 'fa' ? 'متن شرایط قابل مطالعه' : 'Readable terms content';
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
          ++sessionReads === 1 || statusReady
            ? {
                json: {
                  navigation: fullNavigation('staff'),
                  operatingContext: 'staff',
                  isStaff: true,
                  userId: 'owner',
                  requiresTosAcceptance: true,
                },
              }
            : { status: 503, json: { isStaff: false } }
        )
      );
      await page.route('**/api/tos/current?*', (route) =>
        route.fulfill(
          contentReady
            ? {
                json: {
                  id: 'terms-v1',
                  versionId: 'v1',
                  content: Array.from({ length: 20 }, (_, index) => `${index + 1}. ${term}`).join(
                    '\n\n'
                  ),
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
      contentReady = true;
      await dialog.getByRole('button', { name: t('tos.page.retry', locale), exact: true }).click();
      const reader = dialog.getByRole('region', { name: t('tos.modal.document', locale) });
      await expect(reader).toContainText(term);
      await expect(dialog).toContainText('v1');
      const close = dialog.getByRole('button', { name: t('tos.modal.close', locale), exact: true });
      const closeBox = (await close.boundingBox())!;
      const titleBox = (await dialog.getByRole('heading').boundingBox())!;
      if (locale === 'fa') expect(closeBox.x + closeBox.width).toBeLessThanOrEqual(titleBox.x);
      else expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(closeBox.x);
      const accept = dialog.getByRole('button', {
        name: t('tos.modal.accept', locale),
        exact: true,
      });
      await expect(accept).toBeEnabled();
      await expect(accept).toBeInViewport({ ratio: 1 });
      await reader.focus();
      await page.keyboard.press('End');
      await expect.poll(() => reader.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      await expect(accept).toBeInViewport({ ratio: 1 });
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
