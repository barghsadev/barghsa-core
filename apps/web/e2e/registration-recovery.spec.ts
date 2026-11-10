import { registrationFormText } from '@barghsa/i18n/registration-forms';
import { t } from '@barghsa/i18n/auth';
import { mockPublicAuthCsrf } from './public-auth-fixture';
import { test, expect } from './coverage-fixture';

const challengeId = '00000000-0000-4000-8000-000000000001';
const nextChallengeId = '00000000-0000-4000-8000-000000000002';
async function freshRegistration(page: import('@playwright/test').Page, locale: 'en' | 'fa') {
  await page
    .getByRole('button', { name: registrationFormText('restart', locale), exact: true })
    .click();
  await expect(page).toHaveURL(/\/register$/);
  await page.locator('#username').fill('test@example.test');
  await page.locator('#username').press('Tab');
  await page.locator('#password').fill(' Fresh synthetic value 12A ');
  const strength = page.locator('#password-strength').getByRole('progressbar');
  await expect(strength).toHaveAttribute('aria-busy', 'false');
  await expect(strength).toHaveAttribute('aria-valuenow', '100');
  await page.getByRole('checkbox').check();
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(new RegExp(`/register/verify\\?challengeId=${nextChallengeId}`));
}
async function prepareFreshRegistration(page: import('@playwright/test').Page) {
  await page.route('**/api/tos/current?*', (route) =>
    route.fulfill({
      json: {
        id: challengeId,
        versionId: 'v1',
        content: 'Published terms',
        updatedAt: '2026-09-01T00:00:00Z',
        publishedAt: '2026-09-01T00:00:00Z',
      },
    })
  );
  await page.route('**/api/auth/register', (route) =>
    route.fulfill({ json: { challengeId: nextChallengeId } })
  );
}

for (const locale of ['en', 'fa'] as const) {
  test(`registration offers sign-in and recovery only after contact proof (${locale})`, async ({
    page,
  }) => {
    await page.addInitScript((lang) => localStorage.setItem('barghsa.locale', lang), locale);
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await mockPublicAuthCsrf(page);
    const attempts: string[] = [];
    await page.route('**/api/auth/register/verify', (route) => {
      const { challengeId: id, otp } = route.request().postDataJSON();
      expect(id).toBe(challengeId);
      attempts.push(otp);
      const valid = otp === '654321';
      return route.fulfill({
        status: valid ? 409 : 401,
        json: {
          error: {
            code: !valid
              ? 'AUTH:OTP:INVALID'
              : attempts.length === 2
                ? 'AUTH:REGISTER:USERNAME_TAKEN'
                : 'AUTH:OTP:ALREADY_CONSUMED',
          },
        },
      });
    });
    await page.goto(`/register/verify?challengeId=${challengeId}&destination=test%40example.test`);
    const title = page.getByRole('heading', {
      name: t('auth.register.error.usernameTaken', locale),
      exact: true,
    });
    const digits = page.locator('input[inputmode="numeric"]');
    for (let i = 0; i < 6; i++) await digits.nth(i).fill(String(i + 1));
    await expect(
      page.getByText(t('auth.otp.error.invalid', locale), { exact: true })
    ).toBeVisible();
    await expect(title).toHaveCount(0);
    for (let i = 0; i < 6; i++) await digits.nth(i).fill(String(6 - i));
    await expect(title).toBeFocused();
    await expect(digits).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: t('auth.register.loginLinkLabel', locale), exact: true })
    ).toHaveAttribute('href', '/login');
    await expect(
      page.getByRole('link', { name: t('auth.register.forgotPasswordLink', locale), exact: true })
    ).toHaveAttribute('href', '/forgot-password');
    await page.reload();
    for (let i = 0; i < 6; i++) await digits.nth(i).fill(String(6 - i));
    await expect(
      page.getByText(t('auth.otp.error.alreadyConsumed', locale), { exact: true })
    ).toBeVisible();
    await expect(title).toHaveCount(0);
    expect(attempts).toEqual(['123456', '654321', '654321']);
  });
  test(`registration rejects incomplete session and requires a fresh challenge (${locale})`, async ({
    page,
  }) => {
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await mockPublicAuthCsrf(page);
    let attempts = 0;
    await prepareFreshRegistration(page);
    await page.route('**/api/auth/register/verify', (route) => {
      expect(route.request().postDataJSON()).toEqual({
        challengeId: attempts === 0 ? challengeId : nextChallengeId,
        otp: '123456',
      });
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
    await expect(digits.first()).toHaveValue('1');
    await expect(digits.first()).toBeDisabled();
    await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);
    await freshRegistration(page, locale);
    for (let i = 0; i < 6; i++) await digits.nth(i).fill(String(i + 1));
    await expect(page).toHaveURL(/\/app$/);
    expect(attempts).toBe(2);
  });
  test(`registration resend rejects a different challenge (${locale})`, async ({ page }) => {
    await page.clock.install();
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await mockPublicAuthCsrf(page);
    let attempts = 0;
    await prepareFreshRegistration(page);
    await page.route('**/api/auth/register/resend', (route) => {
      expect(route.request().postDataJSON()).toEqual({
        challengeId: attempts === 0 ? challengeId : nextChallengeId,
      });
      attempts++;
      return route.fulfill({
        json: { challengeId: attempts === 1 ? 'different' : nextChallengeId },
      });
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
    await expect(resend).toBeDisabled();
    await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);
    await freshRegistration(page, locale);
    await page.clock.runFor(61000);
    await resend.click();
    await expect.poll(() => attempts).toBe(2);
    await expect(resend).toHaveCount(0);
  });
}

for (const challenge of [42, { invalid: true }, '   ']) {
  test(`registration rejects invalid challenge ${JSON.stringify(challenge)}`, async ({ page }) => {
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await mockPublicAuthCsrf(page);
    await page.route('**/api/tos/current?*', (route) =>
      route.fulfill({
        json: {
          id: challengeId,
          versionId: 'v1',
          content: 'Terms',
          updatedAt: '2026-09-01T00:00:00Z',
          publishedAt: '2026-09-01T00:00:00Z',
        },
      })
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
    const consent = page.getByRole('checkbox');
    await consent.check();
    await expect(consent).toBeChecked();
    const [response] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate.url().endsWith('/api/auth/register') && candidate.request().method() === 'POST'
      ),
      page.locator('button[type="submit"]').click(),
    ]);
    expect(response.status()).toBe(200);
    expect(attempts).toBe(1);
    await expect(
      page
        .locator('form')
        .getByRole('alert')
        .filter({ hasText: registrationFormText('uncertain', 'fa') })
    ).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.locator('#password')).toHaveValue('Browser-registration-password-123!');
    await expect(page.locator('button[type="submit"]')).toBeDisabled();
    await page
      .getByRole('button', { name: registrationFormText('restart', 'fa'), exact: true })
      .click();
    await page.locator('#username').press('Tab');
    await page.locator('#password').fill('Browser-registration-password-123!');
    await page.getByRole('checkbox').check();
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(new RegExp(`/register/verify\\?challengeId=${challengeId}`));
    expect(attempts).toBe(2);
  });
}

test.beforeEach(async ({ page }, info) => {
  await page.addInitScript(
    (lang) => localStorage.setItem('barghsa-locale', lang),
    /\(en\)/.test(info.title) ? 'en' : 'fa'
  );
  await mockPublicAuthCsrf(page);
});
