import { test, expect } from './fixtures';
import { t } from '@barghsa/i18n/auth';

test.describe('Application smoke tests', () => {
  test('home page opens the sign-in screen for a signed-out visitor', async ({ page }) => {
    await page.route('**/api/auth/user', (route) => route.fulfill({ status: 401, json: {} }));
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole('heading', { name: t('auth.login.title', 'fa'), exact: true })
    ).toBeVisible();
  });

  test('application has a valid HTML structure', async ({ page }) => {
    await page.goto('/');
    // Verify the RTL document direction
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fa');

    // Root mounting point exists
    const root = page.locator('#root');
    await expect(root).toBeVisible();
    // The React app should have rendered content inside #root
    await expect(root.locator('h1')).toHaveCount(1);
  });

  test('fixture provides a deterministic test identity', async ({ identity }, testInfo) => {
    const prefix = `e2e-${testInfo.project.name}-w${testInfo.workerIndex}-`;
    expect(identity.startsWith(prefix)).toBe(true);
    expect(identity.slice(prefix.length)).toBe('fixture-provides-a-deterministic-test-identity');
  });
});
