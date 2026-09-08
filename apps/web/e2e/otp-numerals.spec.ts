import { test, expect } from './coverage-fixture';

for (const sample of [
  { name: 'Persian keyboard', value: '۱۲۳۴۵۶', paste: false },
  { name: 'Arabic keyboard', value: '١٢٣٤٥٦', paste: false },
  { name: 'mixed pasted code', value: '۱2٣۴5٦', paste: true },
  { name: 'ASCII keyboard', value: '123456', paste: false },
]) {
  test(`OTP normalizes ${sample.name} and keeps digit order in RTL`, async ({ page }) => {
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({ json: { requiresOtp: true, challengeId: 'digits-challenge' } })
    );
    let submitted: unknown;
    await page.route('**/api/auth/login/verify', (route) => {
      submitted = route.request().postDataJSON();
      return route.fulfill({
        json: {
          userId: 'digits-user',
          sessionId: 'digits-session',
          csrfToken: 'digits-csrf',
          expiresAt: '2030-01-01T00:00:00.000Z',
        },
      });
    });
    await page.goto('/login');
    await page.evaluate(() => {
      document.documentElement.lang = 'fa';
      document.documentElement.dir = 'rtl';
    });
    await page.locator('#username').fill('digits@example.test');
    await page.locator('#username').press('Tab');
    await page.locator('#password').fill('Browser-digits-password-123!');
    await page.locator('button[type=submit]').click();
    const inputs = page.locator('input[inputmode=numeric]');
    await expect(inputs).toHaveCount(6);
    const first = await inputs.first().boundingBox();
    const last = await inputs.last().boundingBox();
    if (sample.paste) {
      await inputs.first().evaluate((input, text) => {
        // Supply the clipboard contract directly for consistent synthetic paste across browsers.
        const event = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', {
          value: { getData: (type: string) => (type === 'text/plain' ? text : '') },
        });
        input.dispatchEvent(event);
      }, sample.value);
    } else {
      for (let index = 0; index < 6; index++) await inputs.nth(index).fill(sample.value[index]!);
    }
    await expect(page).toHaveURL(/\/$/);
    expect(first!.x).toBeLessThan(last!.x);
    expect(submitted).toEqual({
      challengeId: 'digits-challenge',
      otp: '123456',
      trustDevice: false,
    });
  });
}
