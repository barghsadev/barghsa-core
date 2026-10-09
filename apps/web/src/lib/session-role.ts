import { getProfileContextRevision } from './profile-context.js';
import { parseNavigation, type NavigationConfiguration } from './navigation-config.js';

export interface SessionContext {
  userId?: string;
  username?: string;
  email?: string | null;
  mobile?: string | null;
  isStaff: boolean;
  operatingContext: 'staff' | 'customer';
  canSwitchContext: boolean;
  navigation?: NavigationConfiguration;
  navigationRevision?: number;
}

export async function readSessionContext(signal?: AbortSignal): Promise<SessionContext | null> {
  const navigationRevision = getProfileContextRevision();
  const response = await readBootstrapPacket('/api/auth/user', signal, null, navigationRevision);
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('Unable to check session');
  const user: unknown = await response.json();
  if (signal?.aborted || navigationRevision !== getProfileContextRevision())
    throw new DOMException('Session check cancelled', 'AbortError');
  return { ...parseSessionContext(user), navigationRevision };
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
    navigation?: unknown;
  };
  const operatingContext =
    value.operatingContext === 'staff' || value.operatingContext === 'customer'
      ? value.operatingContext
      : value.isStaff
        ? 'staff'
        : 'customer';
  const navigation = parseNavigation(value.navigation, operatingContext);
  return {
    ...(typeof value.userId === 'string' && value.userId ? { userId: value.userId } : {}),
    ...(typeof value.username === 'string' && value.username.trim()
      ? { username: value.username }
      : {}),
    ...(value.email === null || typeof value.email === 'string' ? { email: value.email } : {}),
    ...(value.mobile === null || typeof value.mobile === 'string' ? { mobile: value.mobile } : {}),
    isStaff: value.isStaff,
    operatingContext,
    ...(navigation ? { navigation } : {}),
    canSwitchContext:
      typeof value.canSwitchContext === 'boolean' ? value.canSwitchContext : value.isStaff,
  };
}

export async function readSessionRole(signal?: AbortSignal): Promise<boolean | null> {
  return (await readSessionContext(signal))?.isStaff ?? null;
}

/** Read availability without assuming that an empty or revoked active context means no profiles. */
export async function readProfileAvailability(
  signal: AbortSignal,
  accountId: string | null = null,
  revision = getProfileContextRevision()
): Promise<boolean | null> {
  const response = await readBootstrapPacket('/api/profiles', signal, accountId, revision);
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('Unable to check profiles');
  const body: unknown = await response.json();
  if (signal.aborted || revision !== getProfileContextRevision())
    throw new DOMException('Profile check cancelled', 'AbortError');
  if (
    !body ||
    typeof body !== 'object' ||
    !('profiles' in body) ||
    !Array.isArray(body.profiles) ||
    body.profiles.some(
      (profile) =>
        !profile || typeof profile !== 'object' || typeof profile.id !== 'string' || !profile.id
    )
  )
    throw new Error('Invalid profiles response');
  return body.profiles.length > 0;
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

/** Bootstrap ownership loads only when a route needs an authority read. */
async function readBootstrapPacket(
  path: '/api/auth/user' | '/api/profiles',
  external: AbortSignal | undefined,
  accountId: string | null,
  revision: number
) {
  const { readRouteBootstrap } = await import('./route-bootstrap-read.js');
  return readRouteBootstrap(path, external, accountId, revision);
}
