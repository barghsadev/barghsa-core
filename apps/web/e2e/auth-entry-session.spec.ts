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
  await expect(
    page.getByRole('alert').filter({ hasText: /session has ended|نشست شما پایان یافته/ })
  ).toHaveCount(0);
  expect(
    reads.some((path) => /^\/api\/(?:dashboard|profiles|admin|wallet|invoices)(?:\/|$)/.test(path))
  ).toBe(false);
});

for (const [area, locale] of [
  ['customer', 'en'],
  ['staff', 'fa'],
] as const)
  test(`a verified ${area} session announces its expiry once after protected navigation`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript((lang) => localStorage.setItem('barghsa.locale', lang), locale);
    let expired = false;
    let deniedReads = 0;
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) => {
      if (expired) {
        deniedReads++;
        return route.fulfill({ status: 401, json: { error: 'AUTH:UNAUTHENTICATED' } });
      }
      return route.fulfill({
        json: {
          userId: 'expiry-test-user',
          isStaff: area === 'staff',
          operatingContext: area,
          navigation: fullNavigation(area),
          requiresTosAcceptance: false,
        },
      });
    });
    await page.route('**/api/profiles', (route) =>
      route.fulfill({
        json: {
          activeProfileId: 'profile-1',
          hasDefault: true,
          profiles: [
            { id: 'profile-1', profileType: 'INDIVIDUAL', status: 'ACTIVE', isDefault: true },
          ],
        },
      })
    );
    await page.goto('/app');
    const link = page.locator(`aside a[href="${area === 'staff' ? '/admin/users' : '/wallet'}"]`);
    await expect(link).toBeVisible();
    expired = true;
    await link.click();
    await expect(page).toHaveURL(/\/login$/);
    expect(deniedReads).toBeGreaterThan(0);
    const notice = page.getByRole('alert').filter({
      hasText:
        locale === 'fa'
          ? 'نشست شما پایان یافته است. برای ادامه دوباره وارد شوید.'
          : 'Your session has ended. Sign in again to continue.',
    });
    await expect(notice).toBeFocused();
    await expect(page.locator('#username')).toBeVisible();
    await page.reload();
    await expect(page.locator('#username')).toBeVisible();
    await expect(notice).toHaveCount(0);
  });
