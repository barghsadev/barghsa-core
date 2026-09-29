import { test, expect } from './coverage-fixture';

test('root sends a signed-out visitor to login', async ({ page }) => {
  await page.route('**/api/auth/user', (route) => route.fulfill({ status: 401, json: {} }));
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});

for (const isStaff of [false, true]) {
  test(`root opens the correct dashboard for ${isStaff ? 'staff' : 'customers'}`, async ({
    page,
  }) => {
    let profileReads = 0;
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({ json: { userId: 'viewer', isStaff, requiresTosAcceptance: false } })
    );
    await page.route('**/api/profiles', (route) => {
      profileReads++;
      return route.fulfill({ json: { profiles: [{ id: 'profile' }], hasDefault: true } });
    });

    await page.goto('/');
    await expect(page).toHaveURL(/\/app$/);
    await expect(
      page.locator(isStaff ? '#admin-navigation' : '#dashboard-navigation')
    ).toBeVisible();

    if (isStaff) {
      expect(profileReads).toBe(0);
      await expect(page.locator('#admin-navigation a[href="/wallet"]')).toHaveCount(0);
      await page.goto('/wallet');
      await expect(page).toHaveURL(/\/app$/);
      await page.goto('/electricity/order');
    } else {
      await expect(page.locator('#dashboard-navigation a[href="/wallet"]')).toHaveCount(1);
      await page.goto('/admin/branding');
    }
    await expect(page).toHaveURL(/\/app$/);
  });
}
