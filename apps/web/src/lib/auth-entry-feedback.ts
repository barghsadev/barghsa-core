const key = 'barghsa.auth-entry-feedback';

/** Carry only the success message across the auth-to-application document change. */
export function rememberAuthSuccess(message: string): void {
  if (!import.meta.env.PROD) return;
  try {
    sessionStorage.setItem(key, JSON.stringify({ message, expires: Date.now() + 30_000 }));
  } catch {
    // Storage availability must never block a successful sign-in.
  }
}

export function takeAuthSuccess(): string | null {
  try {
    const raw = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { message, expires } = value as Record<string, unknown>;
    return typeof message === 'string' &&
      message.length <= 500 &&
      typeof expires === 'number' &&
      expires > Date.now() &&
      expires <= Date.now() + 30_000
      ? message
      : null;
  } catch {
    return null;
  }
}
