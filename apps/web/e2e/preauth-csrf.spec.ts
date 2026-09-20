import { test, expect } from './coverage-fixture';

test('login retries a stale pre-login token once and uses the replacement header', async ({
  page,
}) => {
  const submitted: string[] = [];
  let bootstraps = 0;
  await page.route('**/api/auth/csrf', (route) => {
    bootstraps++;
    return route.fulfill({ json: { csrfToken: (bootstraps === 1 ? 'a' : 'b').repeat(64) } });
  });
  await page.route('**/api/auth/login', (route) => {
    submitted.push(route.request().headers()['x-csrf-token'] ?? '');
    return route.fulfill({ status: 403, json: { error: { code: 'AUTHZ:CSRF_TOKEN_INVALID' } } });
  });
  await page.goto('/login');
  await page.locator('#username').fill('csrf@example.test');
  await page.locator('#password').fill('Browser-password-123!');
  await page.locator('button[type=submit]').click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(submitted).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
  expect(bootstraps).toBe(2);
  await expect(page.locator('button[type=submit]')).toBeEnabled();
});

test('bootstrap failure keeps login credentials out of outgoing requests and allows another attempt', async ({
  page,
}) => {
  let credentialsSent = 0;
  await page.route('**/api/auth/csrf', (route) => route.fulfill({ status: 503, json: {} }));
  await page.route('**/api/auth/login', (route) => {
    credentialsSent++;
    return route.fulfill({ status: 401, json: {} });
  });
  await page.goto('/login');
  await page.locator('#username').fill('csrf@example.test');
  await page.locator('#password').fill('Browser-password-123!');
  await page.locator('button[type=submit]').click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(credentialsSent).toBe(0);
  await expect(page.locator('button[type=submit]')).toBeEnabled();
});
