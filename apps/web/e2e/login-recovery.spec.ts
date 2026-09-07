import type { Page } from '@playwright/test';
import { test, expect } from './coverage-fixture';
import { mockOppositeNumerals } from './number-preference-fixture';

const challengeId = '11111111-2222-4333-8444-555555555555';
const generic = {
  en: 'An error occurred. Please try again',
  fa: 'خطایی رخ داده است. لطفاً دوباره تلاش کنید',
};
async function openLogin(page: Page, locale: 'fa' | 'en') {
  await mockOppositeNumerals(page, locale);
  await page.goto('/login');
  await page.evaluate((value) => {
    document.documentElement.lang = value;
  }, locale);
  await page.locator('#username').fill('user@example.test');
  await page.locator('#username').press('Tab');
  await page.locator('#password').fill('Browser-password-123!');
}

for (const locale of ['en', 'fa'] as const) {
  test(`password change needs acknowledgement and preserves retry input (${locale})`, async ({
    page,
  }) => {
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({
        json: {
          requiresOtp: false,
          mustChangePassword: true,
          passwordChangeToken: 'change-token',
        },
      })
    );
    const attempts: unknown[] = [];
    await page.route('**/api/auth/force-change-password', (route) => {
      attempts.push(route.request().postDataJSON());
      return route.fulfill({
        json: attempts.length === 1 ? null : { message: 'Password changed' },
      });
    });
    await openLogin(page, locale);
    await page.locator('button[type="submit"]').click();
    await page.locator('#new-password').fill('New-browser-password-123!');
    await page.locator('#confirm-password').fill('New-browser-password-123!');
    await page.locator('button[type="submit"]').click();
    await expect(page.getByRole('alert').first()).toContainText(generic[locale]);
    await expect(page.locator('#new-password')).toHaveValue('New-browser-password-123!');
    await expect(page.locator('#confirm-password')).toHaveValue('New-browser-password-123!');
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('#password')).toHaveValue('');
    expect(attempts).toEqual(
      Array(2).fill({
        passwordChangeToken: 'change-token',
        newPassword: 'New-browser-password-123!',
      })
    );
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(1);
  });
  test(`resend requires the same challenge acknowledgement (${locale})`, async ({ page }) => {
    await page.clock.install();
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({ json: { requiresOtp: true, challengeId } })
    );
    let attempts = 0;
    await page.route('**/api/auth/login/resend', (route) => {
      expect(route.request().postDataJSON()).toEqual({ challengeId });
      attempts++;
      return route.fulfill({ json: { challengeId: attempts === 1 ? 'unrelated' : challengeId } });
    });
    await openLogin(page, locale);
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('input[inputmode="numeric"]')).toHaveCount(6);
    await page.clock.runFor(61000);
    const resend = page.getByRole('button', {
      name: locale === 'fa' ? 'ارسال مجدد' : 'Resend code',
      exact: true,
    });
    await resend.click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(resend).toBeEnabled();
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
    await resend.click();
    await expect(resend).toHaveCount(0);
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(1);
    expect(attempts).toBe(2);
  });
  test(`login accepts a complete session acknowledgement (${locale})`, async ({ page }) => {
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({
        json: {
          requiresOtp: false,
          userId: 'user',
          sessionId: 'session',
          csrfToken: 'csrf',
          expiresAt: '2030-01-01T00:00:00.000Z',
        },
      })
    );
    await openLogin(page, locale);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(1);
  });
  for (const response of [
    { name: 'null', body: null },
    { name: 'empty', body: {} },
    { name: 'invalid OTP identifier', body: { requiresOtp: true, challengeId: 12 } },
    {
      name: 'invalid password token',
      body: { requiresOtp: false, mustChangePassword: true, passwordChangeToken: {} },
    },
  ]) {
    test(`login rejects ${response.name} acknowledgement (${locale})`, async ({ page }) => {
      await page.route('**/api/auth/login', (route) => route.fulfill({ json: response.body }));
      await openLogin(page, locale);
      await page.locator('button[type="submit"]').click();
      await expect(page.getByRole('alert').first()).toContainText(generic[locale]);
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.locator('#username')).toHaveValue('user@example.test');
      await expect(page.locator('#password')).toHaveValue('Browser-password-123!');
      await expect(page.locator('button[type="submit"]')).toBeEnabled();
    });
  }
  test(`OTP rejects an empty session acknowledgement and permits retry (${locale})`, async ({
    page,
  }) => {
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({ json: { requiresOtp: true, challengeId } })
    );
    const attempts: unknown[] = [];
    await page.route('**/api/auth/login/verify', (route) => {
      attempts.push(route.request().postDataJSON());
      return route.fulfill({ json: null });
    });
    await openLogin(page, locale);
    await page.locator('button[type="submit"]').click();
    await page.locator('#trust-device').check();
    const digits = page.locator('input[inputmode="numeric"]');
    for (let i = 0; i < 6; i++) await digits.nth(i).fill(String(i + 1));
    await expect(page.getByRole('alert').first()).toContainText(generic[locale]);
    await expect(digits.first()).toHaveValue('');
    await expect(digits.first()).toBeEnabled();
    expect(attempts).toEqual([{ challengeId, otp: '123456', trustDevice: true }]);
    await expect(page).toHaveURL(/\/login$/);
  });
}
