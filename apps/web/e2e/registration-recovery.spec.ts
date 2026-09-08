import { test, expect } from './coverage-fixture';

const challengeId = '00000000-0000-4000-8000-000000000001';
for (const locale of ['en', 'fa'] as const) {
  test(`registration rejects incomplete session and allows retry (${locale})`, async ({ page }) => {
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    let attempts = 0;
    await page.route('**/api/auth/register/verify', (route) => {
      expect(route.request().postDataJSON()).toEqual({ challengeId, otp: '123456' });
      attempts++;
      return route.fulfill({
        json:
          attempts === 1
            ? null
            : {
                userId: 'user',
                sessionId: 'session',
                csrfToken: 'csrf',
                expiresAt: '2030-01-01T00:00:00.000Z',
              },
      });
    });
    await page.goto(`/register/verify?challengeId=${challengeId}&destination=test@example.test`);
    await page.evaluate((lang) => {
      document.documentElement.lang = lang;
    }, locale);
    const digits = page.locator('input[inputmode="numeric"]');
    for (let i = 0; i < 6; i++) await digits.nth(i).fill(String(i + 1));
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(page).toHaveURL(/\/register\/verify\?/);
    await expect(digits.first()).toHaveValue('');
    await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);
    for (let i = 0; i < 6; i++) await digits.nth(i).fill(String(i + 1));
    await expect(page).toHaveURL(/\/app$/);
    expect(attempts).toBe(2);
  });
  test(`registration resend rejects a different challenge (${locale})`, async ({ page }) => {
    await page.clock.install();
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    let attempts = 0;
    await page.route('**/api/auth/register/resend', (route) => {
      expect(route.request().postDataJSON()).toEqual({ challengeId });
      attempts++;
      return route.fulfill({ json: { challengeId: attempts === 1 ? 'different' : challengeId } });
    });
    await page.goto(`/register/verify?challengeId=${challengeId}&destination=test@example.test`);
    await page.evaluate((lang) => {
      document.documentElement.lang = lang;
    }, locale);
    await expect(page.locator('input[inputmode="numeric"]')).toHaveCount(6);
    await page.clock.runFor(61000);
    const resend = page.getByRole('button', {
      name: locale === 'fa' ? 'ارسال مجدد' : 'Resend code',
      exact: true,
    });
    await resend.click();
    await expect(resend).toBeEnabled();
    await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);
    await resend.click();
    await expect(resend).toHaveCount(0);
    expect(attempts).toBe(2);
  });
}

for (const challenge of [42, { invalid: true }, '   ']) {
  test(`registration rejects invalid challenge ${JSON.stringify(challenge)}`, async ({ page }) => {
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/tos/current?*', (route) =>
      route.fulfill({ json: { id: challengeId, versionId: 'v1', content: 'Terms' } })
    );
    let attempts = 0;
    await page.route('**/api/auth/register', (route) => {
      attempts++;
      return route.fulfill({ json: { challengeId: attempts === 1 ? challenge : challengeId } });
    });
    await page.goto('/register');
    await page.locator('#username').fill('retry@example.test');
    await page.locator('#username').press('Tab');
    await page.locator('#password').fill('Browser-registration-password-123!');
    await page.getByRole('checkbox').click();
    await page.locator('button[type="submit"]').click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.locator('#password')).toHaveValue('Browser-registration-password-123!');
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(new RegExp(`/register/verify\\?challengeId=${challengeId}`));
    expect(attempts).toBe(2);
  });
}
