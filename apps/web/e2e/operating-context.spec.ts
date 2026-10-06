import { test, expect } from './coverage-fixture';
import { fullNavigation } from './navigation-fixture';
import { shellText } from '@barghsa/i18n/shell';

for (const locale of ['en', 'fa'] as const)
  test(`dual-role user deliberately switches between staff and customer workspaces (${locale})`, async ({
    page,
  }) => {
    await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
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
          navigation: fullNavigation(operatingContext === 'staff' ? 'staff' : 'customer', 'LEGAL'),
        },
      })
    );
    await page.route('**/api/profiles', (route) =>
      route.fulfill({
        json: {
          profiles: [
            {
              id: '01900000-0000-7000-8000-000000000001',
              profileType: 'LEGAL',
              status: 'VERIFIED',
              isDefault: true,
              title: 'Context customer',
              displayName: 'Context customer',
              firstName: null,
              lastName: null,
              nationalId: null,
            },
          ],
          activeProfileId: '01900000-0000-7000-8000-000000000001',
          hasDefault: true,
        },
      })
    );
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'Asia/Tehran' } })
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
    await expect(page.locator('[data-slot=operating-context-indicator]')).toHaveText(
      shellText('staffContext', locale)
    );
    await expect(page.locator('[data-slot=operating-context-indicator]')).toBeVisible();
    await page.getByRole('button', { name: shellText('accountMenu', locale), exact: true }).click();
    await expect(page.getByLabel(shellText('staffContext', locale))).toBeVisible();
    await page.getByRole('button', { name: shellText('switchToCustomer', locale) }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.locator('[data-slot=operating-context-indicator]')).toHaveText(
      shellText('customerContext', locale)
    );
    await expect(page.locator('[data-slot=operating-context-indicator]')).toBeVisible();
    await page.getByRole('button', { name: shellText('accountMenu', locale), exact: true }).click();
    await expect(page.getByLabel(shellText('customerContext', locale))).toBeVisible();
    await page.getByRole('button', { name: shellText('switchToStaff', locale) }).click();
    await expect(page.locator('[data-slot=operating-context-indicator]')).toHaveText(
      shellText('staffContext', locale)
    );
    await expect(page.locator('[data-slot=operating-context-indicator]')).toBeVisible();
    await page.getByRole('button', { name: shellText('accountMenu', locale), exact: true }).click();
    await expect(page.getByLabel(shellText('staffContext', locale))).toBeVisible();
    expect(transitions).toEqual(['customer', 'staff']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
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
        navigation: fullNavigation(operatingContext === 'staff' ? 'staff' : 'customer', 'LEGAL'),
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
