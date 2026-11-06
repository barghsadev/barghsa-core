import { test, expect } from './coverage-fixture';
import { fullNavigation } from './navigation-fixture';
import { formatCurrencyIrr } from '@barghsa/i18n/numbers';
import { t } from '@barghsa/i18n/app';

const profileId = '22222222-2222-4222-8222-222222222222';
for (const locale of ['en', 'fa'] as const) {
  test(`wallet read placeholders expose no invented amount or enabled payment (${locale})`, async ({
    page,
  }, info) => {
    await page.addInitScript(
      (language) => localStorage.setItem('barghsa.locale', language),
      locale
    );
    await page.emulateMedia({
      colorScheme: locale === 'fa' ? 'dark' : 'light',
      reducedMotion: 'reduce',
    });
    await page.setViewportSize({ width: locale === 'fa' ? 390 : 1280, height: 900 });
    const writes: string[] = [];
    await page.route('**/api/**', (route) => {
      if (route.request().method() !== 'GET') writes.push(route.request().url());
      return route.fulfill({ status: 404, json: {} });
    });
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        json: {
          userId: 'placeholder-owner',
          isStaff: false,
          operatingContext: 'customer',
          requiresTosAcceptance: false,
          navigation: fullNavigation('customer'),
        },
      })
    );
    await page.route('**/api/profiles', (route) =>
      route.fulfill({
        json: {
          activeProfileId: profileId,
          hasDefault: true,
          profiles: [
            { id: profileId, profileType: 'LEGAL', title: 'Read owner', status: 'VERIFIED' },
          ],
        },
      })
    );
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'Asia/Tehran' } })
    );
    await page.route(`**/api/wallet/${profileId}/transactions?*`, (route) =>
      route.fulfill({ json: { transactions: [], nextCursor: null } })
    );
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const amount = '9007199254740993';
    await page.route(`**/api/wallet/${profileId}`, async (route) => {
      expect(route.request().method()).toBe('GET');
      await held;
      await route.fulfill({
        json: { balance: amount, currency: 'IRR', onlineTopUpLimit: 0, configVersion: 1 },
      });
    });
    try {
      await page.goto('/wallet');
      const main = page.locator('#dashboard-content');
      const skeleton = main.getByTestId('wallet-loading');
      await expect(skeleton).toBeVisible();
      await expect(skeleton).toHaveAttribute('aria-hidden', 'true');
      await expect(skeleton.locator('..')).toHaveAttribute('role', 'status');
      await expect(main).not.toContainText(formatCurrencyIrr(amount, locale));
      await expect(main.locator('form')).toHaveCount(0);
      expect(writes).toEqual([]);
      await page.screenshot({
        path: info.outputPath(`wallet-pending-${locale}.png`),
        fullPage: true,
      });
      release();
      await expect(skeleton).toHaveCount(0);
      await expect(main).toContainText(formatCurrencyIrr(amount, locale));
      await expect(
        main.getByRole('heading', { name: t('wallet.history.title', locale), exact: true })
      ).toBeVisible();
      expect(writes).toEqual([]);
    } finally {
      release();
    }
  });
}
