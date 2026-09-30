import { test, expect } from './coverage-fixture';

test.use({ locale: 'en-US' });

test('Persian default and a chosen language survive later visits in an English browser', async ({
  page,
}) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));

  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByRole('button', { name: 'تغییر زبان به انگلیسی' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  expect(await page.evaluate(() => localStorage.getItem('barghsa.locale'))).toBe('en');

  await page.evaluate(() => localStorage.removeItem('barghsa.locale'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});
