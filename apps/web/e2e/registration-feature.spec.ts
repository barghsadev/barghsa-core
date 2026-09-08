import { mockPublicAuthCsrf } from './public-auth-fixture';
import type { Page } from '@playwright/test';
import { test, expect } from './coverage-fixture';

const challengeId = '00000000-0000-4000-8000-000000000002';
const password = 'Registration-browser-password-123!';

async function openRegistration(page: Page, locale: string, verify = false) {
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await mockPublicAuthCsrf(page);
  await page.route('**/api/tos/current?*', (route) =>
    route.fulfill({ json: { id: challengeId, versionId: 'v1', content: 'Published terms' } })
  );
  await page.goto(
    verify
      ? `/register/verify?challengeId=${challengeId}&destination=a***@example.test`
      : '/register'
  );
  await page.evaluate((lang) => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
  }, locale);
  await expect(page.locator('main').locator('xpath=..')).toHaveAttribute(
    'dir',
    locale === 'fa' ? 'rtl' : 'ltr'
  );
}

for (const locale of ['fa', 'en']) {
  test(`registration stages input, hides strength after blur/submit and preserves a failed draft (${locale})`, async ({
    page,
  }) => {
    await openRegistration(page, locale);
    const brand = page.getByRole('complementary');
    await expect(brand).toBeVisible();
    await expect(brand.getByRole('listitem')).toHaveCount(3);
    await expect(brand.getByRole('link')).toHaveAttribute('href', '/');
    await expect(page.locator('main a[href="/login"]')).toBeVisible();
    await expect(page.locator('main a[href="/forgot-password"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    const username = page.locator('#username');
    const secret = page.locator('#password');
    await expect(secret).toHaveCount(0);
    await expect(username).toHaveAttribute('maxlength', '255');
    await username.fill('invalid');
    await username.press('Tab');
    await expect(username).toHaveAttribute('aria-invalid', 'true');
    await expect(secret).toHaveCount(0);
    await username.fill('draft@example.test');
    await username.press('Tab');
    await expect(secret).toHaveAttribute('autocomplete', 'new-password');
    await expect(page.getByRole('checkbox')).not.toBeChecked();
    await username.focus();
    await expect(page.locator('#password-strength')).toBeHidden();
    await secret.focus();
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    await secret.fill(password);
    await expect(page.getByRole('progressbar')).toBeVisible();
    await secret.press('Tab');
    await expect(page.locator('#password-strength')).toBeHidden();
    const toggle = page.locator('button[aria-pressed]');
    await toggle.click();
    await expect(secret).toHaveAttribute('type', 'text');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(secret).toHaveAttribute('type', 'password');
    await page.getByRole('checkbox').click();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/auth/register', async (route) => {
      await pending;
      await route.fulfill({ status: 503, json: { error: 'INTERNAL:SERVER_ERROR' } });
    });
    try {
      await secret.focus();
      await secret.press('Enter');
      await expect(secret).toBeDisabled();
      await expect(toggle).toBeDisabled();
      await expect(page.locator('#password-strength')).toBeHidden();
      release();
      await expect(secret).toBeEnabled();
      await expect(page.locator('form [role="alert"]')).toBeVisible();
      const message = await page.locator('form [role="alert"]').innerText();
      await expect(page.locator('[data-sonner-toast][data-type="error"]')).toContainText(message);
      if (locale === 'fa') expect(message).toMatch(/[\u0600-\u06ff]/);
      await expect(username).toHaveValue('draft@example.test');
      await expect(secret).toHaveValue(password);
      await expect(page.locator('#password-strength')).toBeHidden();
    } finally {
      release();
    }
  });

  for (const sample of [
    { input: '09121234567', normalized: '+989121234567', ending: '4567' },
    { input: '+14155552671', normalized: '+14155552671', ending: '2671' },
    { input: 'AB@example.test', normalized: 'ab@example.test', ending: '@example.test' },
  ]) {
    test(`registration masks ${sample.input} before the OTP URL (${locale})`, async ({ page }) => {
      await openRegistration(page, locale);
      await page.route('**/api/auth/register', (route) => {
        expect(route.request().postDataJSON()).toEqual({
          username: sample.normalized,
          password,
          tosVersionId: challengeId,
        });
        return route.fulfill({ json: { challengeId } });
      });
      await page.locator('#username').fill(sample.input);
      await page.locator('#username').press('Tab');
      if (sample.input.startsWith('09'))
        await expect(page.locator('#username-hint')).toHaveText('+98 912 123 4567');
      await page.locator('#password').fill(password);
      await page.getByRole('checkbox').click();
      await page.locator('button[type="submit"]').click();
      await expect(page).toHaveURL(/\/register\/verify\?/);
      const hint = new URL(page.url()).searchParams.get('destination')!;
      expect(hint).toContain('***');
      expect(hint).toContain(sample.ending);
      expect(hint).not.toContain(sample.normalized);
      await expect(page.locator('main')).toContainText(hint);
    });
  }

  test(`OTP uses elapsed cooldown and serializes verify with resend (${locale})`, async ({
    page,
  }) => {
    await page.clock.install();
    await openRegistration(page, locale, true);
    await page.clock.fastForward(61_000);
    const resend = page.getByRole('button', {
      name: locale === 'fa' ? 'ارسال مجدد' : 'Resend code',
      exact: true,
    });
    await expect(resend).toBeEnabled();
    let release!: () => void;
    let pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let verifies = 0;
    let resends = 0;
    await page.route('**/api/auth/register/verify', async (route) => {
      verifies++;
      expect(route.request().postDataJSON()).toEqual({ challengeId, otp: '123456' });
      await pending;
      await route.fulfill({ status: 401, json: { error: 'AUTH:OTP:INVALID' } });
    });
    await page.route('**/api/auth/register/resend', async (route) => {
      resends++;
      expect(route.request().postDataJSON()).toEqual({ challengeId });
      await pending;
      await route.fulfill({ json: { challengeId } });
    });
    const digits = page.locator('input[inputmode="numeric"]');
    try {
      await digits.first().fill('۱۲۳۴۵۶');
      await expect(digits.first()).toBeDisabled();
      await expect(resend).toBeDisabled();
      expect(verifies).toBe(1);
      expect(resends).toBe(0);
      release();
      await expect(digits.first()).toBeEnabled();
      await expect(digits.first()).toHaveValue('');
      await expect(digits.first()).toBeFocused();
      await expect(page.locator('main [role="alert"]')).toBeVisible();
      pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      await resend.click();
      await expect(digits.first()).toBeDisabled();
      expect(verifies).toBe(1);
      release();
      await expect(digits.first()).toBeEnabled();
      await expect(resend).toHaveCount(0);
      expect(resends).toBe(1);
      await page.clock.fastForward(59_000);
      await expect(resend).toHaveCount(0);
      await page.clock.fastForward(2_000);
      await expect(resend).toBeEnabled();
    } finally {
      release();
    }
  });

  test(`registration reaches onboarding through the app entry (${locale})`, async ({ page }) => {
    await openRegistration(page, locale, true);
    await page.route('**/api/profiles', (route) =>
      route.fulfill({ json: { profiles: [], hasDefault: false, activeProfileId: null } })
    );
    await page.route('**/api/auth/register/verify', (route) =>
      route.fulfill({
        json: {
          userId: 'user',
          sessionId: 'session',
          csrfToken: 'csrf',
          expiresAt: '2030-01-01T00:00:00.000Z',
        },
      })
    );
    await page.locator('input[inputmode="numeric"]').first().fill('123456');
    await expect(page).toHaveURL(/\/onboarding$/);
  });

  test(`leaving an expired OTP page cancels its delayed redirect (${locale})`, async ({ page }) => {
    await page.clock.install();
    await openRegistration(page, locale, true);
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
    await page.route('**/api/auth/register/verify', (route) =>
      route.fulfill({ status: 401, json: { error: 'AUTH:OTP:EXPIRED' } })
    );
    await page.locator('input[inputmode="numeric"]').first().fill('123456');
    await expect(page.locator('main [role="alert"]')).toBeVisible();
    await page.getByRole('complementary').getByRole('link').click();
    await expect(page).toHaveURL(/\/$/);
    await page.clock.fastForward(1_000);
    await expect(page).toHaveURL(/\/$/);
    await page.goto(`/register/verify?challengeId=${challengeId}`);
    await page.evaluate((lang) => {
      document.documentElement.lang = lang;
    }, locale);
    await page.locator('input[inputmode="numeric"]').first().fill('123456');
    await expect(page.locator('main [role="alert"]')).toBeVisible();
    await page.clock.fastForward(1_000);
    await expect(page).toHaveURL(/\/register$/);
    await page.clock.runFor(20);
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).toBeVisible();
  });
}

test.beforeEach(async ({ page }) => {
  await mockPublicAuthCsrf(page);
});
