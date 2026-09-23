import { test, expect } from './coverage-fixture';

test.use({ locale: 'en-US' });

test('browser language initializes direction and a new choice survives later visits', async ({
  page,
}) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));

  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await page.getByRole('button', { name: 'Switch language to Persian' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  expect(await page.evaluate(() => localStorage.getItem('barghsa.locale'))).toBe('fa');

  await page.evaluate(() => localStorage.removeItem('barghsa.locale'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
});
