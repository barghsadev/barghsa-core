import { test, expect } from './coverage-fixture';

for (const locale of ['fa', 'en'] as const) {
  test(`staff activation consumes the fragment token without persisting it (${locale})`, async ({
    page,
  }) => {
    const token = 'a'.repeat(64);
    await page.route('**/api/auth/activate-staff', (route) =>
      route.fulfill({ json: { activated: true } })
    );
    await page.goto(`/activate#token=${token}`);
    await expect(page).toHaveURL(/\/activate$/);
    await page.evaluate((value) => {
      document.documentElement.lang = value;
    }, locale);
    await page.locator('#activation-password').fill('Activated-browser-password-123!');
    await page.locator('#activation-confirmation').fill('Activated-browser-password-123!');
    const submitted = page.waitForRequest('**/api/auth/activate-staff');
    await page.locator('button[type="submit"]').click();
    expect((await submitted).postDataJSON()).toEqual({
      token,
      newPassword: 'Activated-browser-password-123!',
    });
    await expect(page.getByRole('status')).toContainText(locale === 'fa' ? 'وارد شوید' : 'Sign in');
    await expect(page.locator('#activation-password')).toHaveCount(0);
    expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain(token);
  });
}

test('missing or rejected activation links never show successful activation', async ({ page }) => {
  await page.goto('/activate');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('button[type="submit"]')).toHaveCount(0);
  await page.route('**/api/auth/activate-staff', (route) =>
    route.fulfill({ status: 401, json: { error: { code: 'AUTH:TOKEN_INVALID' } } })
  );
  await page.goto(`/activate#token=${'b'.repeat(64)}`);
  await page.locator('#activation-password').fill('Activated-browser-password-123!');
  await page.locator('#activation-confirmation').fill('Activated-browser-password-123!');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole('alert')).toContainText('منقضی');
});
