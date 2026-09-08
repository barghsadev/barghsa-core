const PUBLIC_AUTH_PATH =
  /^\/api\/auth\/(?:login(?:\/verify|\/resend)?|register(?:\/verify|\/resend)?|forgot-password|reset-password(?:\/verify)?|force-change-password|activate-staff)$/;

/** Obtain a browser-bound token before each public authentication action. */
export async function publicAuthFetch(path: string, init: RequestInit): Promise<Response> {
  if (!PUBLIC_AUTH_PATH.test(path) || init.method !== 'POST') {
    throw new Error('Invalid public authentication request');
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers = new Headers(init.headers);
    const bootstrap = await fetch('/api/auth/csrf', {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: init.signal ?? null,
      headers: { 'Accept-Language': headers.get('Accept-Language') ?? 'fa' },
    });
    if (!bootstrap.ok) return bootstrap;
    const body = await bootstrap.json();
    if (typeof body?.csrfToken !== 'string' || !/^[a-f0-9]{64}$/.test(body.csrfToken)) {
      throw new Error('Invalid CSRF acknowledgement');
    }
    headers.set('X-CSRF-Token', body.csrfToken);
    const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
    // Another tab can replace the anonymous cookie during bootstrap. Only the
    // CSRF guard's rejection proves auth code did not run and permits a retry.
    if (attempt === 0 && response.status === 403) {
      const error = await response
        .clone()
        .json()
        .catch(() => null);
      if (error?.error?.code === 'AUTHZ:CSRF_TOKEN_INVALID') continue;
    }
    return response;
  }
  throw new Error('Authentication request unavailable');
}
