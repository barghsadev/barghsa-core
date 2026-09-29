export async function readSessionRole(signal?: AbortSignal): Promise<boolean | null> {
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
  return (user as { isStaff: boolean }).isStaff;
}
