import { test, expect } from './coverage-fixture';
for (const locale of ['en', 'fa'] as const) {
  test(`login and emitted metadata identify the v0.2.0 candidate (${locale})`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
    await page.route('**/api/auth/user', (route) => route.fulfill({ status: 401, json: {} }));
    await page.goto('/login');
    await expect(page.locator('[data-app-version]')).toHaveText('v0.2.0');
    const metadata = await page.request.get('/release.json');
    expect(metadata.status()).toBe(200);
    expect(await metadata.json()).toMatchObject({ version: '0.2.0' });
    await page.screenshot({
      path: `/Users/majid/.local/state/barghsa-manual-batches/release-0.2-closure/login-${locale}-${test.info().project.name}.png`,
      fullPage: true,
    });
  });
}
