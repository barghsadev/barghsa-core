/** HTTP test client using the same bootstrap contract as the browser. Security tests use raw fetch. */
export async function fetchWithPreauth(url: string, init: RequestInit): Promise<Response> {
  const target = new URL(url);
  if (
    init.method !== 'POST' ||
    !/^\/api\/auth\/(?:login(?:\/verify|\/resend)?|register(?:\/verify|\/resend)?|forgot-password|reset-password(?:\/verify)?|force-change-password|activate-staff)$/.test(
      target.pathname
    )
  )
    return fetch(url, init);
  const headers = new Headers(init.headers);
  const bootstrap = await fetch(new URL('/api/auth/csrf', target), { headers });
  if (!bootstrap.ok) return bootstrap;
  const { csrfToken } = (await bootstrap.json()) as { csrfToken: string };
  const cookies = new Map(
    (headers.get('Cookie') ?? '')
      .split(';')
      .filter(Boolean)
      .map((cookie) => {
        const [name, ...value] = cookie.trim().split('=');
        return [name!, value.join('=')] as const;
      })
  );
  for (const cookie of bootstrap.headers.getSetCookie()) {
    const [name, ...value] = cookie.split(';')[0]!.split('=');
    cookies.set(name!, value.join('='));
  }
  headers.set('Cookie', [...cookies].map(([name, value]) => `${name}=${value}`).join('; '));
  headers.set('X-CSRF-Token', csrfToken);
  return fetch(url, { ...init, headers });
}
