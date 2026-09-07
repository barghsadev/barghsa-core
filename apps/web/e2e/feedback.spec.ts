import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';

for (const locale of ['en', 'fa'] as const) {
  for (const darkMode of [false, true]) {
    test(`registration feedback survives navigation and follows locale/theme (${locale}, dark=${darkMode})`, async ({
      page,
    }) => {
      await page.addInitScript((value) => {
        if (document.documentElement) document.documentElement.lang = value;
        new MutationObserver(() => {
          if (document.documentElement) document.documentElement.lang = value;
        }).observe(document, { childList: true });
      }, locale);
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/public/branding/config', (route) =>
        route.fulfill({
          json: {
            appTitle: 'Feedback test',
            slogan: '',
            primaryColor: '#2563eb',
            secondaryColor: '#64748b',
            accentColor: '#f59e0b',
            logoUrl: null,
            faviconUrl: null,
            darkMode,
            numberStyle: 'locale',
          },
        })
      );
      const challengeId = '00000000-0000-4000-8000-000000000001';
      let verified = 0;
      await page.route('**/api/auth/register/verify', (route) => {
        expect(route.request().postDataJSON()).toEqual({ challengeId, otp: '123456' });
        verified++;
        return route.fulfill({ json: {} });
      });
      await page.goto(
        `/register/verify?challengeId=${challengeId}&destination=feedback@example.test`
      );
      const inputs = page.locator('input[inputmode="numeric"]');
      await expect(inputs).toHaveCount(6);
      for (let index = 0; index < 6; index++) await inputs.nth(index).fill(String(index + 1));
      await expect(page).toHaveURL(/\/$/);
      const messages = page.getByRole('region', {
        name: locale === 'fa' ? 'پیام‌های برنامه' : 'Application messages',
        exact: true,
      });
      const notice = messages.locator('[data-sonner-toast]');
      await expect(notice).toContainText(
        locale === 'fa' ? 'حساب شما با موفقیت ایجاد شد' : 'Account created successfully'
      );
      await expect(notice).toHaveCount(1);
      await expect(messages).toHaveAttribute('aria-live', 'polite');
      const list = messages.locator('[data-sonner-toaster]');
      await expect(list).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
      await expect(list).toHaveAttribute('data-sonner-theme', darkMode ? 'dark' : 'light');
      // Measure readable, settled content rather than the entrance fade.
      await expect(notice).toHaveCSS('opacity', '1');
      const contrast = await new AxeBuilder({ page })
        .include('[data-sonner-toaster]')
        .withRules(['color-contrast'])
        .analyze();
      expect(contrast.violations).toEqual([]);
      expect(contrast.incomplete).toEqual([]);
      const close = messages.getByRole('button', {
        name: locale === 'fa' ? 'بستن پیام' : 'Dismiss message',
        exact: true,
      });
      await close.focus();
      await close.press('Enter');
      await expect(notice).toHaveCount(0);
      expect(verified).toBe(1);
    });
  }
}

for (const trusted of [false, true]) {
  test(`login submits keyboard-selected trusted device (${trusted})`, async ({ page }) => {
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    const challengeId = '00000000-0000-4000-8000-000000000001';
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({ json: { requiresOtp: true, challengeId } })
    );
    let submitted = false;
    await page.route('**/api/auth/login/verify', (route) => {
      expect(route.request().postDataJSON()).toEqual({
        challengeId,
        otp: '123456',
        trustDevice: trusted,
      });
      submitted = true;
      return route.fulfill({
        json: {
          userId: 'feedback-user',
          sessionId: 'feedback-session',
          csrfToken: 'feedback-csrf',
          expiresAt: '2030-01-01T00:00:00.000Z',
        },
      });
    });
    await page.goto('/login');
    await page.locator('#username').fill('feedback@example.test');
    await page.locator('#username').press('Tab');
    await page.locator('#password').fill('Browser-feedback-password-123!');
    await page.locator('button[type="submit"]').click();
    const checkbox = page.getByRole('checkbox');
    await expect(checkbox).not.toBeChecked();
    await checkbox.focus();
    await checkbox.press('Space');
    await expect(checkbox).toBeChecked();
    if (!trusted) {
      await checkbox.press('Space');
      await expect(checkbox).not.toBeChecked();
    }
    const inputs = page.locator('input[inputmode="numeric"]');
    for (let index = 0; index < 6; index++) await inputs.nth(index).fill(String(index + 1));
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(1);
    expect(submitted).toBe(true);
  });
}

for (const locale of ['en', 'fa'] as const) {
  test(`expired registration shows error after redirect (${locale})`, async ({ page }) => {
    await page.addInitScript((value) => {
      if (document.documentElement) document.documentElement.lang = value;
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/register/verify', (route) =>
      route.fulfill({ status: 400, json: { error: { code: 'AUTH:OTP:EXPIRED' } } })
    );
    await page.goto(
      '/register/verify?challengeId=00000000-0000-4000-8000-000000000001&destination=feedback@example.test'
    );
    const inputs = page.locator('input[inputmode="numeric"]');
    for (let index = 0; index < 6; index++) await inputs.nth(index).fill(String(index + 1));
    await expect(page).toHaveURL(/\/register\/?$/);
    const notice = page.locator('[data-sonner-toast]');
    await expect(notice).toHaveCount(1);
    await expect(notice).toHaveAttribute('data-type', 'error');
    await expect(notice).toContainText(
      locale === 'fa'
        ? 'کد تأیید منقضی شده است. لطفاً دوباره ثبت‌نام کنید'
        : 'The verification code has expired. Please register again'
    );
  });
}

test('dashboard header and navigation use configured brand title', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/public/branding/config', (route) =>
    route.fulfill({
      json: {
        appTitle: 'Configured company',
        slogan: '',
        primaryColor: '#2563eb',
        secondaryColor: '#64748b',
        accentColor: '#f59e0b',
        logoUrl: null,
        faviconUrl: null,
        darkMode: false,
        numberStyle: 'locale',
      },
    })
  );
  await page.goto('/dashboard');
  await expect(page.locator('header a[href="/"]')).toHaveText('Configured company');
  const menu = page.locator('button[aria-controls="dashboard-navigation"]');
  if (await menu.isVisible()) await menu.click();
  await expect(page.locator('#dashboard-navigation a[href="/"]')).toHaveText('Configured company');
});
