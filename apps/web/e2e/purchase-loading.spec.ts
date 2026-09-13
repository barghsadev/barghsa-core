import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from './coverage-fixture';
import { t } from '@barghsa/i18n/app';
import { feedbackText } from '@barghsa/i18n/feedback';

const dist = process.env['BARGHSA_BROWSER_COVERAGE'] === '1' ? 'dist-coverage' : 'dist';
const manifest = JSON.parse(readFileSync(resolve(dist, '.vite/manifest.json'), 'utf8'));

for (const locale of ['en', 'fa'] as const) {
  test(`entry navigation retains language and reloads the matching bundle (${locale})`, async ({
    page,
  }) => {
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.goto('/support');
    // Change this document only. No init script restores it after navigation.
    await page.evaluate((language) => {
      document.documentElement.lang = language;
      document.documentElement.dataset['entryCheck'] = 'old';
    }, locale);
    await page.locator('a[href="/login"]').first().click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('html')).not.toHaveAttribute('data-entry-check', 'old');
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
    await expect(page.locator('script[type="module"][src^="/auth/assets/"]')).toHaveCount(1);
    // Moving focus out of the empty username shows its validation message.
    // Activate the support link by keyboard after that layout update.
    await page.locator('a[href="/support"]').first().focus();
    await page.locator('a[href="/support"]').first().press('Enter');
    await expect(page).toHaveURL(/\/support$/);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.locator('script[type="module"][src^="/assets/"]')).toHaveCount(1);
  });
  test(`purchase navigation needs no lazy code and heavy pages show stable loading (${locale})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript((language) => {
      const apply = () => {
        if (document.documentElement) document.documentElement.lang = language;
      };
      apply();
      new MutationObserver(apply).observe(document, { childList: true });
    }, locale);
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({ json: { userId: 'loading-user', requiresTosAcceptance: false } })
    );
    await page.route('**/api/profiles/verification-status', (route) =>
      route.fulfill({
        json: { activeProfileId: 'profile-one', verificationRequired: false, isVerified: false },
      })
    );
    await page.route('**/api/products', (route) => route.fulfill({ json: [] }));
    await page.route('**/api/profiles/profile-one/addresses', (route) =>
      route.fulfill({ json: { addresses: [] } })
    );
    await page.goto('/electricity/order');
    const main = page.locator('#dashboard-content');
    await expect(
      main.getByRole('heading', { name: t('electricity.order.title', locale), exact: true })
    ).toBeVisible();
    for (const path of ['electricity/index', 'electricity/order', 'savings', 'wallet'])
      expect(manifest[`src/routes/_app/${path}.tsx?tsr-split=component`]).toBeUndefined();
    expect(manifest['src/routes/_app.tsx?tsr-split=component']).toBeUndefined();
    for (const path of ['ai', 'documents', 'charts', 'videos'])
      expect(manifest[`src/routes/_app/${path}.tsx?tsr-split=component`]).toBeTruthy();
    expect(manifest['src/routes/admin/index.tsx?tsr-split=component']).toBeTruthy();

    const scripts: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/*.js', async (route) => {
      scripts.push(route.request().url());
      await held;
      await route.continue();
    });
    try {
      await page.evaluate(() => {
        document.documentElement.dataset['entryCheck'] = 'same';
      });
      for (const path of ['/electricity', '/savings', '/wallet']) {
        await page.locator(`#dashboard-navigation a[href="${path}"]`).click();
        await expect(page).toHaveURL(new RegExp(path + '$'));
        await expect(main.getByRole('heading').first()).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-entry-check', 'same');
        expect(scripts).toEqual([]);
      }
      const header = page.getByRole('banner');
      const before = await header.boundingBox();
      await page.locator('#dashboard-navigation a[href="/videos"]').click();
      await expect.poll(() => scripts.length).toBeGreaterThan(0);
      const pending = main.getByRole('status', {
        name: feedbackText('loading', locale),
        exact: true,
      });
      await expect(pending).toBeVisible();
      expect(await header.boundingBox()).toEqual(before);
      const blocks = pending.locator('[data-slot="skeleton"]');
      await expect(blocks).toHaveCount(3);
      expect(
        await blocks.first().evaluate((e) => getComputedStyle(e, '::after').animationName)
      ).toBe('none');
      release();
      await expect(page).toHaveURL(/\/videos$/);
      await expect(main.getByRole('heading').first()).toBeVisible();
      expect(await header.boundingBox()).toEqual(before);
    } finally {
      release();
    }
  });
}
