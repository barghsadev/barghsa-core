import { test, expect } from './coverage-fixture';
import { fullNavigation } from './navigation-fixture';

for (const path of ['/login', '/register', '/register/verify', '/forgot-password', '/activate'])
  test(`authenticated entry leaves ${path} before rendering a public form`, async ({ page }) => {
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', async (route) => {
      reads++;
      await ready;
      return route.fulfill({
        json: {
          userId: 'signed-in-owner',
          username: 'private-login@example.test',
          isStaff: true,
          operatingContext: 'staff',
          navigation: fullNavigation('staff'),
          requiresTosAcceptance: false,
        },
      });
    });
    await page.goto(path);
    await expect.poll(() => reads).toBeGreaterThan(0);
    await expect(page.locator('input[type=password],form')).toHaveCount(0);
    await expect(page.getByText('private-login@example.test', { exact: true })).toHaveCount(0);
    release();
    await expect(page).toHaveURL(/\/app$/);
  });

test('an expired session can use the public form without loading workspace data', async ({
  page,
}) => {
  const reads: string[] = [];
  await page.route('**/api/**', (route) => {
    reads.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 404, json: {} });
  });
  await page.route('**/api/auth/user', (route) => route.fulfill({ status: 401, json: {} }));
  await page.goto('/login');
  await expect(page.locator('#username')).toBeVisible();
  await expect(page.locator('#password')).toBeVisible();
  expect(
    reads.some((path) => /^\/api\/(?:dashboard|profiles|admin|wallet|invoices)(?:\/|$)/.test(path))
  ).toBe(false);
});
