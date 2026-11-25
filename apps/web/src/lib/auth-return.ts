const taskSections = new Set([
  'admin',
  'ai',
  'app',
  'consultations',
  'contracts',
  'documents',
  'electricity',
  'invoices',
  'notifications',
  'savings',
  'settings',
  'solar',
  'tickets',
  'wallet',
]);
const key = 'barghsa.onboarding-return';

/** Keep a same-origin task path. Authentication tokens and search values stay out of the handoff. */
export function authReturnPath(raw: unknown): string | undefined {
  if (
    typeof raw !== 'string' ||
    raw.length > 1024 ||
    !/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/?$/.test(raw)
  )
    return undefined;
  const path = raw.replace(/\/$/, '');
  return path !== '/app' && taskSections.has(path.split('/')[1]!) ? path : undefined;
}

export function authReturnSearch(search: Record<string, unknown>) {
  const returnTo = authReturnPath(search.returnTo);
  return returnTo ? { returnTo } : { returnTo: undefined };
}

export function rememberOnboardingReturn(owner: string | null, pathname: string) {
  const target = authReturnPath(pathname);
  if (!owner || !target || target.startsWith('/admin')) return;
  try {
    sessionStorage.setItem(
      key,
      JSON.stringify({ owner, target, expiresAt: Date.now() + 7_200_000 })
    );
  } catch {
    // The normal Home destination remains available when storage is disabled.
  }
}

export function onboardingReturn(owner: string | null | undefined, consume = false) {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null') as {
      owner?: unknown;
      target?: unknown;
      expiresAt?: unknown;
    } | null;
    if (
      !owner ||
      !value ||
      value.owner !== owner ||
      typeof value.expiresAt !== 'number' ||
      !Number.isFinite(value.expiresAt) ||
      value.expiresAt <= Date.now()
    )
      return undefined;
    const target = authReturnPath(value.target);
    if (consume) sessionStorage.removeItem(key);
    return target?.startsWith('/admin') ? undefined : target;
  } catch {
    return undefined;
  }
}
