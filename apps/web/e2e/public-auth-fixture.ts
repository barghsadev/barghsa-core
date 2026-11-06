import type { Page } from '@playwright/test';

/** Transport acknowledgement for mocked auth screens; real guard coverage lives in API HTTP tests. */
export async function mockPublicAuthCsrf(page: Page) {
  await page.route('**/api/auth/user', (route) => {
    // Auth screens begin anonymous; the existing workspace fixture owns the handoff.
    const path = new URL(page.url()).pathname;
    return /^\/(?:login|register|forgot-password|activate)(?:\/|$)/.test(path)
      ? route.fulfill({ status: 401, json: {} })
      : route.fallback();
  });
  await page.route('**/api/auth/csrf', (route) =>
    route.fulfill({ json: { csrfToken: 'c'.repeat(64) } })
  );
}
