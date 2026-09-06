import { test, expect } from '@playwright/test';

for (const locale of ['en', 'fa'] as const) {
  test(`username change requires both codes and preserves them after rejection (${locale})`, async ({
    page,
  }) => {
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/profiles', (route) =>
      route.fulfill({
        json: {
          profiles: [{ id: 'profile', profileType: 'LEGAL', title: 'Test' }],
          activeProfileId: 'profile',
          hasDefault: true,
        },
      })
    );
    let username = 'old@example.test',
      fail = true;
    const attempts: unknown[] = [];
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({ json: { userId: 'user', username, email: username, mobile: null } })
    );
    await page.route('**/api/auth/change-username/send-otp', (route) =>
      route.fulfill({
        json: {
          challengeId: '10000000-0000-4000-8000-000000000001',
          destination: 'new@example.test',
          previousDestination: 'old@example.test',
        },
      })
    );
    await page.route('**/api/auth/change-username', (route) => {
      attempts.push(route.request().postDataJSON());
      if (fail) return route.fulfill({ status: 401, json: { error: 'AUTH:OTP:INVALID' } });
      username = 'new@example.test';
      return route.fulfill({ json: { message: 'changed' } });
    });
    await page.goto('/settings/username');
    await page
      .getByRole('button', {
        name: locale === 'en' ? 'Change username' : 'تغییر نام کاربری',
        exact: true,
      })
      .click();
    await page.locator('#new-username').fill('NEW@example.test');
    await page
      .getByRole('button', {
        name: locale === 'en' ? 'Send Verification Code' : 'ارسال کد تأیید',
        exact: true,
      })
      .click();
    await expect(page.locator('#previous-otp')).toBeVisible();
    const submit = page.getByRole('button', {
      name: locale === 'en' ? 'Verify & Save' : 'تأیید و ذخیره',
      exact: true,
    });
    await page.locator('#change-otp').fill('123456');
    await expect(submit).toBeDisabled();
    await page.locator('#previous-otp').fill('112233');
    await submit.click();
    await expect(page.locator('#previous-otp')).toHaveValue('112233');
    await expect(submit).toBeEnabled();
    expect(attempts).toHaveLength(1);
    fail = false;
    await submit.click();
    await expect(page.locator('#previous-otp')).toHaveCount(0);
    expect(attempts).toEqual(
      Array(2).fill({
        newUsername: 'new@example.test',
        otpChallengeId: '10000000-0000-4000-8000-000000000001',
        otp: '123456',
        previousOtp: '112233',
      })
    );
    expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain('112233');
  });
}
