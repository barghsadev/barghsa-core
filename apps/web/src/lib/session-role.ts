export interface SessionContext {
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
  if (
    !user ||
    typeof user !== 'object' ||
    typeof (user as { isStaff?: unknown }).isStaff !== 'boolean'
  )
    throw new Error('Invalid session response');
  const value = user as {
    isStaff: boolean;
    operatingContext?: unknown;
    canSwitchContext?: unknown;
  };
  return {
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
