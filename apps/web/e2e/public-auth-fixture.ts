import type { Page } from '@playwright/test';

/** Transport acknowledgement for mocked auth screens; real guard coverage lives in API HTTP tests. */
export async function mockPublicAuthCsrf(page: Page) {
  await page.route('**/api/auth/csrf', (route) =>
    route.fulfill({ json: { csrfToken: 'c'.repeat(64) } })
  );
}
