export interface SessionContext {
  userId?: string;
  username?: string;
  email?: string | null;
  mobile?: string | null;
  isStaff: boolean;
  operatingContext: 'staff' | 'customer';
  canSwitchContext: boolean;
}

export async function readSessionContext(signal?: AbortSignal): Promise<SessionContext | null> {
  const response = await fetch('/api/auth/user', {
    credentials: 'include',
    signal: signal ?? null,
    headers: { Accept: 'application/json' },
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('Unable to check session');
  const user: unknown = await response.json();
  return parseSessionContext(user);
}

export function parseSessionContext(user: unknown): SessionContext {
  if (
    !user ||
    typeof user !== 'object' ||
    typeof (user as { isStaff?: unknown }).isStaff !== 'boolean'
  )
    throw new Error('Invalid session response');
  const value = user as {
    isStaff: boolean;
    userId?: unknown;
    username?: unknown;
    email?: unknown;
    mobile?: unknown;
    operatingContext?: unknown;
    canSwitchContext?: unknown;
  };
  return {
    ...(typeof value.userId === 'string' && value.userId ? { userId: value.userId } : {}),
    ...(typeof value.username === 'string' && value.username.trim()
      ? { username: value.username }
      : {}),
    ...(value.email === null || typeof value.email === 'string' ? { email: value.email } : {}),
    ...(value.mobile === null || typeof value.mobile === 'string' ? { mobile: value.mobile } : {}),
    isStaff: value.isStaff,
    operatingContext:
      value.operatingContext === 'staff' || value.operatingContext === 'customer'
        ? value.operatingContext
        : value.isStaff
          ? 'staff'
          : 'customer',
    canSwitchContext:
      typeof value.canSwitchContext === 'boolean' ? value.canSwitchContext : value.isStaff,
  };
}

export async function readSessionRole(signal?: AbortSignal): Promise<boolean | null> {
  return (await readSessionContext(signal))?.isStaff ?? null;
}

/** Personal settings available in either workspace; business profiles stay customer-only. */
export function isAccountSettingsPath(pathname: string): boolean {
  return [
    '/settings',
    '/settings/security',
    '/settings/privacy',
    '/settings/username',
    '/settings/timezone',
  ].includes(pathname.replace(/\/$/, ''));
}
