import { test, expect } from './coverage-fixture';

test('dual-role user deliberately switches between staff and customer workspaces', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('barghsa.locale', 'en'));
  let operatingContext: 'staff' | 'customer' = 'staff';
  const transitions: string[] = [];
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: 'dual-role-user',
        isStaff: true,
        operatingContext,
        canSwitchContext: true,
        requiresTosAcceptance: false,
      },
    })
  );
  await page.route('**/api/auth/sessions/context', (route) => {
    const { context } = route.request().postDataJSON() as { context: 'staff' | 'customer' };
    transitions.push(context);
    operatingContext = context;
    return route.fulfill({ json: { operatingContext } });
  });

  await page.goto('/admin/failed-notifications');
  await page.evaluate(() => {
    document.cookie = 'barghsa_csrf=test-csrf; path=/';
  });
  await expect(page.getByLabel('Staff mode')).toBeVisible();
  await page.getByRole('button', { name: 'Switch to customer' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByLabel('Customer mode')).toBeVisible();
  await page.getByRole('button', { name: 'Switch to staff' }).click();
  await expect(page.getByLabel('Staff mode')).toBeVisible();
  expect(transitions).toEqual(['customer', 'staff']);
});

test('dual-role user can onboard only in customer context', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('barghsa.locale', 'en'));
  let operatingContext: 'staff' | 'customer' = 'staff';
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: 'dual-role-user',
        isStaff: true,
        operatingContext,
        canSwitchContext: true,
        requiresTosAcceptance: false,
      },
    })
  );

  await page.goto('/onboarding');
  await expect(page).toHaveURL(/\/app$/);

  operatingContext = 'customer';
  await page.goto('/onboarding');
  await expect(page).toHaveURL(/\/onboarding\/?$/);
  await expect(page.locator('h1')).toBeVisible();
});
