import { mockOppositeNumerals } from './number-preference-fixture';
import { test, expect } from './coverage-fixture';

for (const locale of ['fa', 'en'] as const) {
  for (const path of ['login', 'register', 'forgot-password'] as const) {
    test(`${path} keeps input and shows localized retry timing (${locale})`, async ({ page }) => {
      await mockOppositeNumerals(page, locale);
      await page.route('**/api/tos/current?*', (route) =>
        route.fulfill({
          json: {
            id: '00000000-0000-4000-8000-000000000001',
            versionId: 'test-terms',
            content: 'Terms',
          },
        })
      );
      await page.route(`**/api/auth/${path}`, (route) =>
        route.fulfill({
          status: 429,
          headers: { 'Retry-After': '125' },
          json: { error: { code: 'RATE_LIMIT:EXCEEDED' } },
        })
      );
      await page.goto(`/${path}`);
      await page.evaluate((value) => {
        document.documentElement.lang = value;
      }, locale);
      await page.locator('#username').fill('rate@example.test');
      await page.locator('#username').press('Tab');
      if (path !== 'forgot-password')
        await page.locator('#password').fill('Browser-rate-password-123!');
      if (path === 'register') await page.getByRole('checkbox').click();
      await page.locator('button[type="submit"]').click();
      await expect(page.getByRole('alert').first()).toContainText(
        locale === 'fa' ? '125 ثانیه' : '۱۲۵ seconds'
      );
      await expect(page.locator('#username')).toHaveValue('rate@example.test');
      if (path === 'forgot-password')
        await expect(page.locator('button[type="submit"]')).toBeDisabled();
      else await expect(page.locator('#password')).toHaveValue('Browser-rate-password-123!');
      const support = page.getByRole('link', {
        name:
          locale === 'fa'
            ? 'مشکل دارید؟ با پشتیبانی تماس بگیرید'
            : 'Having trouble? Contact support',
      });
      await support.focus();
      await support.press('Enter');
      await expect(page).toHaveURL(/\/support$/);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        locale === 'fa' ? 'پشتیبانی بازیابی حساب' : 'Account Recovery Support'
      );
      await expect(page.locator('main').locator('..')).toHaveAttribute(
        'dir',
        locale === 'fa' ? 'rtl' : 'ltr'
      );
      await page
        .getByRole('link', { name: locale === 'fa' ? 'بازگشت به فرم ورود' : 'Back to login' })
        .click();
      await expect(page).toHaveURL(/\/login$/);
    });
  }
  for (const flow of ['login', 'register'] as const) {
    test(`${flow} resend respects server cooldown (${locale})`, async ({ page }) => {
      await mockOppositeNumerals(page, locale);
      await page.clock.install();
      await page.route('**/api/auth/login', (route) =>
        route.fulfill({
          json: { requiresOtp: true, challengeId: '00000000-0000-4000-8000-000000000001' },
        })
      );
      let resends = 0;
      await page.route(`**/api/auth/${flow}/resend`, (route) => {
        resends++;
        return route.fulfill({
          status: 429,
          headers: { 'Retry-After': '125' },
          json: { error: { code: 'AUTH:OTP:RATE_LIMITED' } },
        });
      });
      await page.goto(
        flow === 'login'
          ? '/login'
          : '/register/verify?challengeId=00000000-0000-4000-8000-000000000001&destination=rate@example.test'
      );
      await page.evaluate((value) => {
        document.documentElement.lang = value;
      }, locale);
      if (flow === 'login') {
        await page.locator('#username').fill('rate@example.test');
        await page.locator('#username').press('Tab');
        await page.locator('#password').fill('Browser-rate-password-123!');
        await page.locator('button[type="submit"]').click();
      }
      await expect(page.locator('input[inputmode="numeric"]')).toHaveCount(6);
      await page.clock.runFor(61000);
      const resend = page.getByRole('button', {
        name: locale === 'fa' ? 'ارسال مجدد' : 'Resend code',
        exact: true,
      });
      await resend.click();
      await expect(page.getByRole('alert').first()).toContainText(
        locale === 'fa' ? '125 ثانیه' : '۱۲۵ seconds'
      );
      await expect(
        page.getByText(locale === 'fa' ? 'ارسال مجدد در 125 ثانیه' : 'Resend in ۱۲۵s', {
          exact: true,
        })
      ).toBeVisible();
      await expect(resend).toHaveCount(0);
      await page.clock.runFor(60000);
      await expect(resend).toHaveCount(0);
      expect(resends).toBe(1);
      await page.clock.runFor(66000);
      await expect(resend).toBeEnabled();
    });
  }
}
