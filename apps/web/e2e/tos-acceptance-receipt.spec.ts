import { test, expect } from './coverage-fixture';
import { fullNavigation } from './navigation-fixture';
import { t } from '@barghsa/i18n/terms';

for (const locale of ['en', 'fa'] as const) {
  for (const invalid of ['empty', 'wrong-version', 'no-body'] as const) {
    test(`terms acceptance retains review after ${invalid} acknowledgement and sends once (${locale})`, async ({
      page,
      baseURL,
    }) => {
      const version = '01900000-0000-7000-8000-000000000001';
      let required = true,
        writes = 0,
        statusReads = 0;
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
      await page
        .context()
        .addCookies([{ url: baseURL!, name: 'barghsa_csrf', value: 'terms-csrf' }]);
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/auth/user', (route) => {
        statusReads++;
        return route.fulfill({
          json: {
            userId: 'receipt-viewer',
            isStaff: false,
            operatingContext: 'customer',
            navigation: fullNavigation('customer', 'LEGAL'),
            requiresTosAcceptance: required,
          },
        });
      });
      await page.route('**/api/profiles', (route) =>
        route.fulfill({
          json: {
            profiles: [
              {
                id: version,
                profileType: 'LEGAL',
                status: 'ACTIVE',
                isDefault: true,
                title: 'Terms profile',
                firstName: null,
                lastName: null,
                nationalId: null,
              },
            ],
            activeProfileId: version,
            hasDefault: true,
          },
        })
      );
      await page.route('**/api/user/settings/timezone', (route) =>
        route.fulfill({ json: { timezone: 'Asia/Tehran' } })
      );
      await page.route('**/api/tos/current?*', (route) =>
        route.fulfill({
          json: {
            id: version,
            versionId: 'v1',
            content: 'Displayed terms',
            updatedAt: '2026-10-01T00:00:00Z',
            publishedAt: '2026-10-01T00:00:00Z',
          },
        })
      );
      await page.route(`**/api/tos/accept/${version}`, async (route) => {
        writes++;
        expect(route.request().headers()['x-csrf-token']).toBe('terms-csrf');
        if (writes === 1) {
          if (invalid === 'no-body') return route.fulfill({ status: 204 });
          return route.fulfill({
            json:
              invalid === 'empty'
                ? {}
                : { acceptedVersionId: '01900000-0000-7000-8000-000000000002' },
          });
        }
        await pending;
        required = false;
        return route.fulfill({ json: { acceptedVersionId: version } });
      });
      await page.goto('/tickets');
      await page.getByRole('button', { name: t('tos.banner.review', locale), exact: true }).click();
      const dialog = page.getByRole('dialog');
      const accept = dialog.getByRole('button', {
        name: t('tos.modal.accept', locale),
        exact: true,
      });
      await expect(accept).toBeEnabled();
      await accept.click();
      await expect(dialog).toContainText(t('tos.modal.error', locale));
      await expect(accept).toBeDisabled();
      await dialog.getByRole('button', { name: t('tos.modal.close', locale), exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(
        page.getByRole('alert').filter({ hasText: t('tos.banner.text', locale) })
      ).toBeVisible();
      // A service denial must recheck the account and reopen a dismissed review.
      await page.evaluate(() => window.dispatchEvent(new Event('barghsa:tos-required')));
      await expect(accept).toBeEnabled();
      await accept.evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
      });
      try {
        await expect.poll(() => writes).toBe(2);
        await expect(
          dialog.getByRole('button', { name: t('tos.modal.accepting', locale), exact: true })
        ).toBeDisabled();
        expect(writes).toBe(2);
      } finally {
        release();
      }
      await expect(dialog).toHaveCount(0);
      expect(writes).toBe(2);
      const reads = statusReads;
      await page.evaluate(() => window.dispatchEvent(new Event('barghsa:tos-required')));
      await expect.poll(() => statusReads).toBeGreaterThan(reads);
      await expect(
        page.getByRole('alert').filter({ hasText: t('tos.banner.text', locale) })
      ).toHaveCount(0);
      await expect(dialog).toHaveCount(0);
    });
  }
}
