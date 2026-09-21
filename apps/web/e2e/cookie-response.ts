import type { Route } from '@playwright/test';

// WebKit may finish a mocked response before installing its Set-Cookie header.
// Synchronize this non-HttpOnly CSRF fixture before letting application code resume.
// Real HTTP cookie delivery and scope are covered separately by session-cookies.spec.ts.
export async function cookieResponse(
  route: Route,
  response: { status?: number; headers?: Record<string, string>; json: unknown }
) {
  const headers = { ...response.headers };
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== 'set-cookie') continue;
    if (!value.startsWith('barghsa_csrf=') || /;\s*HttpOnly/i.test(value))
      throw new Error('Cookie fixture only supports readable CSRF cookies');
    await route
      .request()
      .frame()
      .page()
      .evaluate((cookie) => {
        document.cookie = cookie;
      }, value);
    delete headers[name];
  }
  return route.fulfill({ ...response, headers });
}
