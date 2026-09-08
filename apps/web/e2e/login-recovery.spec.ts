import { mockPublicAuthCsrf } from './public-auth-fixture';
import type { Page } from '@playwright/test';
import { test, expect } from './coverage-fixture';
import { mockOppositeNumerals } from './number-preference-fixture';
import AxeBuilder from '@axe-core/playwright';

const challengeId = '11111111-2222-4333-8444-555555555555';
const sessionAcknowledgement = {
  requiresOtp: false,
  userId: 'user',
  sessionId: 'session',
  csrfToken: 'csrf',
  expiresAt: '2030-01-01T00:00:00.000Z',
};
const generic = {
  en: 'An error occurred. Please try again',
  fa: 'خطایی رخ داده است. لطفاً دوباره تلاش کنید',
};
async function mockApp(page: Page, hasProfile = true) {
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await mockPublicAuthCsrf(page);
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: hasProfile
          ? [{ id: 'profile-one', profileType: 'LEGAL', title: 'Profile', isDefault: true }]
          : [],
        activeProfileId: hasProfile ? 'profile-one' : null,
        hasDefault: hasProfile,
      },
    })
  );
  await page.route('**/api/dashboard', (route) =>
    route.fulfill({ json: { profile: { name: 'Profile' } } })
  );
}
async function openLogin(page: Page, locale: 'fa' | 'en', darkMode = false) {
  await mockOppositeNumerals(page, locale);
  if (darkMode)
    await page.route('**/api/public/branding/config', (route) =>
      route.fulfill({
        json: {
          appTitle: 'Preference test',
          slogan: '',
          primaryColor: '#2563eb',
          secondaryColor: '#64748b',
          accentColor: '#f59e0b',
          logoUrl: null,
          faviconUrl: null,
          darkMode: true,
          numberStyle: locale === 'fa' ? 'western' : 'persian',
        },
      })
    );
  await page.goto('/login');
  await page.evaluate((value) => {
    document.documentElement.lang = value;
  }, locale);
  await page.locator('#username').fill('user@example.test');
  await page.locator('#username').press('Tab');
  await page.locator('#password').fill('Browser-password-123!');
}

for (const locale of ['en', 'fa'] as const) {
  for (const darkMode of [false, true]) {
    test(`forced password change validates policy, protects the pending request and returns to login (${locale}, dark=${darkMode})`, async ({
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
      let release: (() => void) | undefined;
      await page.route('**/api/auth/force-change-password', async (route) => {
        attempts.push(route.request().postDataJSON());
        if (attempts.length === 1) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return route.fulfill({ status: 503, json: {} });
        }
        return route.fulfill({ json: { message: 'Password changed' } });
      });
      await openLogin(page, locale, darkMode);
      await page.locator('button[type="submit"]').click();
      const password = page.locator('#new-password');
      const confirm = page.locator('#confirm-password');
      const submit = page.locator('button[type="submit"]');
      const back = page.getByRole('button', {
        name: locale === 'fa' ? 'بازگشت به فرم ورود' : 'Back to login',
        exact: true,
      });
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        locale === 'fa' ? 'تغییر رمز عبور الزامی است' : 'Password change required'
      );
      await expect(password).toBeFocused();
      await expect(password).toHaveAttribute('autocomplete', 'new-password');
      await expect(confirm).toHaveAttribute('autocomplete', 'new-password');
      for (const weak of [
        'Short1A',
        'lowercase12345',
        'UPPERCASE12345',
        'NoNumericValue',
        'Aa1' + 'x'.repeat(126),
      ]) {
        await password.fill(weak);
        await confirm.fill(weak);
        await submit.click();
        await expect(page.getByRole('alert').first()).toContainText(
          locale === 'fa'
            ? 'رمز عبور الزامات امنیتی را ندارد'
            : 'Password does not meet security requirements'
        );
        expect(attempts).toHaveLength(0);
      }
      await password.fill('Fresh-browser-password-123!');
      await confirm.fill('Different-browser-password-123!');
      await expect(submit).toBeDisabled();
      await expect(confirm).toHaveAttribute('aria-invalid', 'true');
      await confirm.fill('Fresh-browser-password-123!');
      await submit.click();
      await expect.poll(() => attempts.length).toBe(1);
      await expect(password).toBeDisabled();
      await expect(confirm).toBeDisabled();
      await expect(submit).toBeDisabled();
      await expect(back).toBeDisabled();
      await page.keyboard.press('Enter');
      expect(attempts).toHaveLength(1);
      release!();
      await expect(submit).toBeEnabled();
      await expect(page.getByRole('alert').first()).toBeVisible();
      await expect(password).toHaveValue('Fresh-browser-password-123!');
      await expect(confirm).toHaveValue('Fresh-browser-password-123!');
      await submit.evaluate(async (element) => {
        await Promise.all(element.getAnimations().map((animation) => animation.finished));
      });
      const accessibility = await new AxeBuilder({ page })
        .include('form')
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();
      expect(accessibility.violations).toEqual([]);
      expect(accessibility.incomplete.filter((item) => item.id === 'color-contrast')).toEqual([]);
      await submit.click();
      await expect(password).toHaveCount(0);
      await expect(page.locator('#password')).toHaveValue('');
      await expect(page.locator('#username')).toHaveValue('user@example.test');
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.locator('[data-sonner-toast]')).toContainText(
        locale === 'fa' ? 'لطفاً با رمز جدید وارد شوید' : 'Please log in with your new password'
      );
      expect(attempts).toEqual(
        Array(2).fill({
          passwordChangeToken: 'change-token',
          newPassword: 'Fresh-browser-password-123!',
        })
      );
    });
  }
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
    await mockApp(page);
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({ json: sessionAcknowledgement })
    );
    await openLogin(page, locale);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toContainText(
      'Profile'
    );
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(1);
    await page.reload();
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toContainText(
      'Profile'
    );
  });
  test(`login sends an account without profiles to onboarding (${locale})`, async ({ page }) => {
    await mockApp(page, false);
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({ json: sessionAcknowledgement })
    );
    await openLogin(page, locale);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/onboarding$/);
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
    await mockApp(page);
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({ json: { requiresOtp: true, challengeId } })
    );
    const attempts: unknown[] = [];
    await page.route('**/api/auth/login/verify', (route) => {
      attempts.push(route.request().postDataJSON());
      return route.fulfill({ json: attempts.length === 1 ? null : sessionAcknowledgement });
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
    for (let i = 0; i < 6; i++) await digits.nth(i).fill(String(i + 1));
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toContainText(
      'Profile'
    );
    expect(attempts).toEqual(Array(2).fill({ challengeId, otp: '123456', trustDevice: true }));
  });
}

test.beforeEach(async ({ page }) => {
  await mockPublicAuthCsrf(page);
});
