import { test, expect } from './coverage-fixture';
import { mockPublicAuthCsrf } from './public-auth-fixture';
import { measureControlContrast } from './control-contrast';

for (const sample of [
  { name: 'Persian keyboard', value: '۱۲۳۴۵۶', paste: false, dark: false },
  { name: 'Arabic keyboard', value: '١٢٣٤٥٦', paste: false, dark: true },
  { name: 'mixed pasted code', value: '۱2٣۴5٦', paste: true, dark: false },
  { name: 'ASCII keyboard', value: '123456', paste: false, dark: true },
]) {
  test(`OTP normalizes ${sample.name} and keeps digit order in RTL`, async ({ page }, info) => {
    await page.emulateMedia({
      colorScheme: sample.dark ? 'dark' : 'light',
      reducedMotion: 'reduce',
    });
    await page.addInitScript(
      (theme) => localStorage.setItem('barghsa.theme.v1', theme),
      sample.dark ? 'dark' : 'light'
    );
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await mockPublicAuthCsrf(page);
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({ json: { requiresOtp: true, challengeId: 'digits-challenge' } })
    );
    let signedIn = false;
    await page.route('**/api/auth/user', (route) =>
      route.fulfill(
        signedIn
          ? {
              json: {
                userId: 'digits-user',
                isStaff: true,
                operatingContext: 'staff',
                requiresTosAcceptance: false,
              },
            }
          : { status: 401, json: {} }
      )
    );
    let submitted: unknown;
    await page.route('**/api/auth/login/verify', (route) => {
      submitted = route.request().postDataJSON();
      signedIn = true;
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
    const root = page.locator('html');
    await expect
      .poll(() => root.evaluate((node) => node.classList.contains('dark')))
      .toBe(sample.dark);
    const measurements = [];
    for (const high of [false, true]) {
      await root.evaluate((node, enabled) => {
        if (enabled) node.dataset.contrast = 'more';
        else delete node.dataset.contrast;
      }, high);
      await inputs.first().focus();
      await page.keyboard.press('Tab');
      await expect(inputs.nth(1)).toBeFocused();
      const empty = await measureControlContrast(inputs.last(), 'underline');
      const focus = await measureControlContrast(inputs.nth(1), 'focus');
      measurements.push({ high, dark: sample.dark, empty, focus });
      expect.soft(empty, 'Empty OTP input boundary').toBeGreaterThanOrEqual(3);
      expect.soft(focus, 'OTP keyboard focus ring').toBeGreaterThanOrEqual(3);
    }
    await info.attach('otp-contrast', {
      body: JSON.stringify(measurements),
      contentType: 'application/json',
    });
    await root.evaluate((node) => delete node.dataset.contrast);
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
    // Login retains an explicit verification step so device trust stays an opt-in.
    await expect(page.locator('#trust-device')).toBeEnabled();
    await page.locator('button[type=submit]').click();
    await expect(page).toHaveURL(/\/app$/);
    expect(first!.x).toBeLessThan(last!.x);
    expect(submitted).toEqual({
      challengeId: 'digits-challenge',
      otp: '123456',
      trustDevice: false,
    });
  });
}
