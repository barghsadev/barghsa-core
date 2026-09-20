import { mockPublicAuthCsrf } from './public-auth-fixture';
import { test, expect } from './coverage-fixture';
import type { Page } from '@playwright/test';

const token = 'a'.repeat(64);
async function mockVerification(page: Page) {
  await page.route('**/api/auth/reset-password/verify', (route) =>
    route.fulfill({
      json: {
        verified: true,
        challengeId: route.request().postDataJSON().challengeId,
        resetToken: token,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      },
    })
  );
}
async function enterCode(page: Page, locale = 'en') {
  await expect(page.locator('#new-password')).toHaveCount(0);
  const verified = page.waitForRequest('**/api/auth/reset-password/verify');
  await expect(page.locator('#reset-otp input')).toHaveCount(6);
  await page
    .locator('#reset-otp input')
    .first()
    .fill(locale === 'fa' ? '۱۲۳۴۵۶' : '123456');
  expect((await verified).postDataJSON()).toMatchObject({ otp: '123456' });
  await expect(page.locator('#new-password')).toBeFocused();
  await expect(page.locator('#reset-otp input').first()).toHaveCount(0);
}

for (const locale of ['fa', 'en'] as const) {
  test(`password recovery submits the issued challenge and clears secrets (${locale})`, async ({
    page,
  }) => {
    const challengeId = '00000000-0000-4000-8000-000000000001';
    await mockVerification(page);
    await page.route('**/api/auth/forgot-password', (route) =>
      route.fulfill({ json: { sent: true, challengeId } })
    );
    await page.route('**/api/auth/reset-password', (route) =>
      route.fulfill({ json: { message: 'ok' } })
    );
    await page.goto('/forgot-password');
    await page.evaluate((value) => {
      document.documentElement.lang = value;
    }, locale);
    await page.locator('#username').fill('Recovery@Example.test');
    const issued = page.waitForRequest('**/api/auth/forgot-password');
    await page.locator('button[type="submit"]').click();
    expect((await issued).postDataJSON()).toEqual({ username: 'recovery@example.test' });
    await enterCode(page, locale);
    await page.locator('#new-password').fill('New-browser-password-123!');
    await page.locator('#confirm-password').fill('Does-not-match-123!');
    await page.locator('button[type="submit"]').click();
    await expect(page.getByRole('alert')).toContainText(
      locale === 'fa' ? 'یکسان نیستند' : 'do not match'
    );
    await page.locator('#confirm-password').fill('New-browser-password-123!');
    const reset = page.waitForRequest('**/api/auth/reset-password');
    await page.locator('button[type="submit"]').click();
    expect((await reset).postDataJSON()).toEqual({
      challengeId,
      resetToken: token,
      newPassword: 'New-browser-password-123!',
    });
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('[data-sonner-toast]')).toContainText(
      locale === 'fa' ? 'وارد شوید' : 'Sign in'
    );
    await expect(page.locator('#reset-otp input').first()).toHaveCount(0);
    expect(page.url()).not.toContain('123456');
    expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain('123456');
    await page.goto('/forgot-password');
    await expect(page.locator('#username')).toHaveValue('');
    await expect(page.locator('#reset-otp input').first()).toHaveCount(0);
  });
}

test('rejected OTP leaves verification usable without showing password fields', async ({
  page,
}) => {
  await page.route('**/api/auth/forgot-password', (route) =>
    route.fulfill({ json: { sent: true, challengeId: '00000000-0000-4000-8000-000000000001' } })
  );
  await page.route('**/api/auth/reset-password/verify', (route) =>
    route.fulfill({ status: 401, json: { error: { code: 'AUTH:OTP:INVALID' } } })
  );
  await page.goto('/forgot-password');
  await page.locator('#username').fill('recovery@example.test');
  await page.locator('button[type="submit"]').click();
  await page.locator('#reset-otp input').first().fill('123456');
  await expect(page.getByRole('alert')).toContainText('نامعتبر');
  await expect(page.locator('#reset-otp input').first()).toBeEnabled();
  await expect(page.locator('#new-password')).toHaveCount(0);
});

for (const locale of ['en', 'fa'] as const) {
  test(`reset needs acknowledgement before clearing input (${locale})`, async ({ page }) => {
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await mockPublicAuthCsrf(page);
    await page.route('**/api/auth/forgot-password', (route) =>
      route.fulfill({ json: { sent: true, challengeId: 'reset-challenge' } })
    );
    await mockVerification(page);
    let attempts = 0;
    await page.route('**/api/auth/reset-password', (route) => {
      attempts++;
      return route.fulfill({ json: attempts === 1 ? {} : { message: 'Password changed' } });
    });
    await page.goto('/forgot-password');
    await page.evaluate((lang) => {
      document.documentElement.lang = lang;
    }, locale);
    await page.locator('#username').fill('retry@example.test');
    await page.locator('button[type="submit"]').click();
    await enterCode(page, locale);
    await page.locator('#new-password').fill('New-browser-password-123!');
    await page.locator('#confirm-password').fill('New-browser-password-123!');
    await page.locator('button[type="submit"]').click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.locator('#new-password')).toHaveValue('New-browser-password-123!');
    await expect(page.locator('#reset-otp input').first()).toHaveCount(0);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('[data-sonner-toast]')).toContainText(
      locale === 'fa' ? 'وارد شوید' : 'Sign in'
    );
    await expect(page.locator('#new-password')).toHaveCount(0);
    expect(attempts).toBe(2);
  });
  for (const result of [null, { challengeId: '   ' }]) {
    test(`recovery rejects malformed acknowledgement ${JSON.stringify(result)} (${locale})`, async ({
      page,
    }) => {
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await mockPublicAuthCsrf(page);
      await page.route('**/api/auth/forgot-password', (route) => route.fulfill({ json: result }));
      await page.goto('/forgot-password');
      await page.evaluate((lang) => {
        document.documentElement.lang = lang;
      }, locale);
      await page.locator('#username').fill('retry@example.test');
      await page.locator('button[type="submit"]').click();
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(page.locator('#username')).toHaveValue('retry@example.test');
      await expect(page.locator('button[type="submit"]')).toBeEnabled();
      await expect(page.locator('#reset-otp input').first()).toHaveCount(0);
    });
  }
  test(`recovery honors rate limiting with an empty response (${locale})`, async ({ page }) => {
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await mockPublicAuthCsrf(page);
    await page.route('**/api/auth/forgot-password', (route) =>
      route.fulfill({ status: 429, headers: { 'Retry-After': '30' }, json: null })
    );
    await page.goto('/forgot-password');
    await page.evaluate((lang) => {
      document.documentElement.lang = lang;
    }, locale);
    await page.locator('#username').fill('retry@example.test');
    await page.locator('button[type="submit"]').click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeDisabled();
  });
}

for (const invalid of ['missing-token', 'mismatched-challenge', 'false-verification', 'expired']) {
  test(`OTP acknowledgement rejects ${invalid} before password entry`, async ({ page }) => {
    await page.route('**/api/auth/forgot-password', (route) =>
      route.fulfill({ json: { sent: true, challengeId: 'challenge' } })
    );
    await page.route('**/api/auth/reset-password/verify', (route) =>
      route.fulfill({
        json: {
          verified: invalid !== 'false-verification',
          challengeId: invalid === 'mismatched-challenge' ? 'wrong' : 'challenge',
          resetToken: invalid === 'missing-token' ? undefined : token,
          expiresAt: new Date(
            Date.now() + (invalid === 'expired' ? -60_000 : 300_000)
          ).toISOString(),
        },
      })
    );
    await page.goto('/forgot-password');
    await page.locator('#username').fill('reset@example.test');
    await page.locator('button[type="submit"]').click();
    await page.locator('#reset-otp input').first().fill('123456');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.locator('#reset-otp input').first()).toHaveValue('');
    await expect(page.locator('#new-password')).toHaveCount(0);
  });
}

for (const stage of ['verify', 'complete']) {
  test(`reset ${stage} honors its own cooldown without confusing resend delay`, async ({
    page,
  }) => {
    await page.clock.install();
    await page.route('**/api/auth/forgot-password', (route) =>
      route.fulfill({ json: { sent: true, challengeId: 'challenge' } })
    );
    await mockVerification(page);
    const endpoint =
      stage === 'verify' ? '**/api/auth/reset-password/verify' : '**/api/auth/reset-password';
    await page.route(endpoint, (route) =>
      route.fulfill({ status: 429, headers: { 'Retry-After': '30' }, json: null })
    );
    await page.goto('/forgot-password');
    await page.locator('#username').fill('reset@example.test');
    await page.locator('button[type="submit"]').click();
    if (stage === 'complete') {
      await enterCode(page);
      await page.locator('#new-password').fill('New-browser-password-123!');
      await page.locator('#confirm-password').fill('New-browser-password-123!');
      await page.locator('button[type="submit"]').click();
    } else await page.locator('#reset-otp input').first().fill('123456');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeDisabled();
    await page.clock.runFor(31_000);
    if (stage === 'complete') await expect(page.locator('button[type="submit"]')).toBeEnabled();
    else await expect(page.locator('#reset-otp input').first()).toBeEnabled();
  });
}

test('reset grant expires after the resend countdown and clears the password form', async ({
  page,
}) => {
  await page.clock.install();
  await page.route('**/api/auth/forgot-password', (route) =>
    route.fulfill({ json: { sent: true, challengeId: 'challenge' } })
  );
  await mockVerification(page);
  await page.goto('/forgot-password');
  await page.locator('#username').fill('reset@example.test');
  await page.locator('button[type="submit"]').click();
  await enterCode(page);
  await page.locator('#new-password').fill('New-browser-password-123!');
  await page.clock.runFor(301_000);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('#new-password')).toHaveCount(0);
  await expect(page.locator('#reset-otp input').first()).toHaveValue('');
  expect(await page.evaluate(() => JSON.stringify([sessionStorage, localStorage]))).not.toContain(
    token
  );
});

test('duplicate pending verification submits once and reveals password fields only after acknowledgement', async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route('**/api/auth/forgot-password', (route) =>
    route.fulfill({ json: { sent: true, challengeId: 'challenge' } })
  );
  await page.route('**/api/auth/reset-password/verify', async (route) => {
    requests++;
    await held;
    await route.fulfill({
      json: {
        verified: true,
        challengeId: 'challenge',
        resetToken: token,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      },
    });
  });
  try {
    await page.goto('/forgot-password');
    await page.locator('#username').fill('reset@example.test');
    await page.locator('button[type="submit"]').click();
    await page.locator('#reset-otp input').first().fill('123456');
    await page.locator('form').evaluate((form) => {
      form.requestSubmit();
      form.requestSubmit();
    });
    await expect.poll(() => requests).toBe(1);
    await expect(page.locator('button[type="submit"]')).toBeDisabled();
    await expect(page.locator('#new-password')).toHaveCount(0);
    release();
    await expect(page.locator('#new-password')).toBeVisible();
    expect(requests).toBe(1);
  } finally {
    release();
  }
});

test.beforeEach(async ({ page }) => {
  await mockPublicAuthCsrf(page);
});

for (const locale of ['fa', 'en'] as const) {
  test(`recovery shares mobile OTP keyboard, paste, auto-submit and error recovery (${locale})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/auth/forgot-password', (route) =>
      route.fulfill({ json: { sent: true, challengeId: 'recovery-mobile' } })
    );
    let requests = 0;
    await page.route('**/api/auth/reset-password/verify', (route) => {
      requests++;
      expect(route.request().postDataJSON()).toEqual({
        challengeId: 'recovery-mobile',
        otp: '123456',
      });
      expect(route.request().headers()['x-csrf-token']).toBe('c'.repeat(64));
      return route.fulfill({ status: 401, json: { error: { code: 'AUTH:OTP:INVALID' } } });
    });
    await page.goto('/forgot-password');
    await page.evaluate((lang) => {
      document.documentElement.lang = lang;
    }, locale);
    await page.locator('#username').fill('mobile@example.test');
    await page.locator('button[type=submit]').click();
    const digits = page.locator('#reset-otp input');
    await expect(digits).toHaveCount(6);
    await expect(digits.first()).toBeFocused();
    await expect(page.locator('#reset-otp [role=group]')).toHaveAttribute('dir', 'ltr');
    await digits.nth(0).fill('1');
    await expect(digits.nth(1)).toBeFocused();
    await digits.nth(1).fill('2');
    await expect(digits.nth(2)).toBeFocused();
    await digits.nth(2).press('Backspace');
    await expect(digits.nth(1)).toBeFocused();
    await digits.nth(1).press('ArrowRight');
    await expect(digits.nth(2)).toBeFocused();
    await digits.first().evaluate(
      (input, code) => {
        const clipboardData = new DataTransfer();
        clipboardData.setData('text/plain', code);
        input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData }));
      },
      locale === 'fa' ? '۱۲۳۴۵۶' : '123456'
    );
    await expect(page.getByRole('alert')).toBeVisible();
    expect(requests).toBe(1);
    for (let index = 0; index < 6; index++) await expect(digits.nth(index)).toHaveValue('');
    await expect(digits.first()).toBeFocused();
    await expect(page.locator('#new-password')).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
  });
}
