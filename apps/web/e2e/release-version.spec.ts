import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { shellText } from '@barghsa/i18n/shell';
import { readFileSync } from 'node:fs';
const version: string = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')
).version;

for (const locale of ['en', 'fa'] as const) {
  test(`login displays the shared release version (${locale})`, async ({ page }, info) => {
    await setupCatalogueForms(page, locale, locale === 'fa');
    await page.addInitScript(
      (language) => localStorage.setItem('barghsa-locale', language),
      locale
    );
    await page.goto('/login');
    const badge = page.locator('[data-app-version]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(`v${version}`);
    await expect(badge).toHaveAttribute('dir', 'ltr');
    await expect(badge.locator('..')).toHaveText(`${shellText('appVersion', locale)} v${version}`);
    const metadata = await (await page.request.get('/release.json')).json();
    expect(metadata).toEqual({ version, commit: expect.stringMatching(/^[a-f0-9]{40}$/) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await page.screenshot({
      path: `test-results/release-version-${locale}-${info.project.name}.png`,
      fullPage: true,
    });
  });
}
