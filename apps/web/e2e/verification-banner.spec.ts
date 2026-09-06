import { test, expect } from '@playwright/test';

for (const locale of ['fa', 'en'] as const)
  test(`verification banner explains unavailable automatic approval and permits support (${locale})`, async ({
    page,
  }) => {
    await page.addInitScript((lang) => {
      new MutationObserver(() => {
        document.documentElement.lang = lang;
      }).observe(document, { childList: true });
    }, locale);
    await page.route('**/api/**', (route) => route.fulfill({ status: 401, json: {} }));
    await page.route('**/api/profiles/verification-status', (route) =>
      route.fulfill({
        json: {
          activeProfileId: '11111111-1111-4111-8111-111111111111',
          profileStatus: 'PENDING_VERIFICATION',
          isVerified: false,
          verificationRequired: true,
          verificationMethod: 'api',
          canAutoVerify: false,
        },
      })
    );
    await page.goto('/tickets');
    const banner = page.getByRole('alert').filter({
      hasText: locale === 'fa' ? 'پروفایل شما تأیید نشده است' : 'Your profile is not verified',
    });
    await expect(banner).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
    await expect(banner).toContainText(
      locale === 'fa' ? 'تأیید خودکار در دسترس نیست' : 'Automatic verification is unavailable'
    );
    await expect(
      banner.getByRole('button', {
        name: locale === 'fa' ? 'تأیید خودکار' : 'Auto-verify',
        exact: true,
      })
    ).toHaveCount(0);
    await expect(banner.getByRole('link')).toHaveAttribute('href', '/tickets');
    await banner
      .getByRole('button', { name: locale === 'fa' ? 'بستن' : 'Dismiss', exact: true })
      .focus();
    await page.keyboard.press('Enter');
    await expect(banner).toHaveCount(0);
    await expect(page).toHaveURL(/\/tickets$/);
  });

test('verification banner changes language on the mounted page', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 401, json: {} }));
  await page.route('**/api/profiles/verification-status', (route) =>
    route.fulfill({
      json: {
        activeProfileId: '11111111-1111-4111-8111-111111111111',
        profileStatus: 'PENDING_VERIFICATION',
        isVerified: false,
        verificationRequired: true,
        verificationMethod: 'manual',
        canAutoVerify: false,
      },
    })
  );
  await page.goto('/tickets');
  await page.evaluate(() => {
    document.documentElement.lang = 'en';
  });
  await expect(
    page.getByRole('alert').filter({ hasText: 'Your profile is not verified' })
  ).toHaveAttribute('dir', 'ltr');
  await page.evaluate(() => {
    document.documentElement.lang = 'fa';
  });
  await expect(
    page.getByRole('alert').filter({ hasText: 'پروفایل شما تأیید نشده است' })
  ).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('link', { name: 'پیگیری تأیید از پشتیبانی' })).toBeVisible();
});
