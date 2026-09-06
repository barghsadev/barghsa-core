import { test, expect } from '@playwright/test';
test('target validation and confirmation preserve settings through a failed save', async ({
  page,
}) => {
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (document.documentElement) document.documentElement.lang = 'en';
    }).observe(document, { childList: true });
  });
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  let values = { ticket: 24, verification_case: null },
    verified = false,
    fail = true;
  const attempts: unknown[] = [];
  await page.route('**/api/admin/config/service-response-targets', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: values });
    attempts.push(route.request().postDataJSON());
    if (!verified) return route.fulfill({ status: 403, json: { requiresStepUp: true } });
    if (fail) return route.fulfill({ status: 500, json: {} });
    values = route.request().postDataJSON();
    return route.fulfill({ json: values });
  });
  await page.route('**/api/auth/step-up', (route) => {
    verified = true;
    return route.fulfill({ json: { verified: true } });
  });
  await page.goto('/admin/service-targets');
  const input = page.getByLabel('Hours — Tickets', { exact: true });
  for (const invalid of ['0', '1.5', '8761']) {
    await input.fill(invalid);
    await page.getByRole('button', { name: 'Save response targets', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await input.fill('72');
  await page.getByRole('button', { name: 'Save response targets', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Tickets: 72 Hours');
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await dialog.getByLabel('Confirm your password').fill('Test-password');
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  expect(values.ticket).toBe(24);
  await expect(page.getByText('Changes saved.', { exact: true })).toHaveCount(0);
  fail = false;
  await dialog.getByLabel('Confirm your password').fill('Test-password');
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(attempts).toEqual(Array(3).fill({ ticket: 72, verification_case: null }));
});
test('target settings deny controls when access is unavailable', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 403, json: {} }));
  await page.goto('/admin/service-targets');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('form')).toHaveCount(0);
});
