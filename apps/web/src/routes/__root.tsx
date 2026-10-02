import { useProfileContextRevision } from '../lib/profile-context.js';
import { readSessionContext, readProfileAvailability } from '../lib/session-role.js';
import {
  createRootRoute,
  Outlet,
  useLocation,
  useMatches,
  useRouter,
  redirect,
} from '@tanstack/react-router';
import { isAuthEntryPath } from '../../entry-routes.js';
import { rememberEntryLocale } from '../lib/entry-locale.js';
import { TanStackRouterDevtools } from '@tanstack/router-devtools';
import { lazy, Suspense, useEffect } from 'react';
const VerificationBanner = lazy(() =>
  import('../components/VerificationBanner.js').then((module) => ({
    default: module.VerificationBanner,
  }))
);
const DefaultProfileModal = lazy(() =>
  import('../components/DefaultProfileModal.js').then((module) => ({
    default: module.DefaultProfileModal,
  }))
);
import { UiDirectionProvider } from '../providers/UiDirectionProvider.js';
import { BrandThemeProvider } from '../providers/BrandThemeProvider.js';
import { ApplicationToaster } from '../components/ApplicationToaster.js';

export const Route = createRootRoute({
  beforeLoad: async ({ location, preload, abortController }) => {
    if (import.meta.env.PROD && isAuthEntryPath(location.pathname) !== __BARGHSA_AUTH_ENTRY__) {
      if (!preload) rememberEntryLocale();
      throw redirect({ href: location.href, reloadDocument: true });
    }
    if (location.pathname === '/app' || location.pathname.startsWith('/app/')) {
      const session = await readSessionContext(abortController.signal);
      if (session === null) throw redirect({ to: '/login', replace: true });
      const isStaff = session.operatingContext === 'staff';
      if (!isStaff) {
        const available = await readProfileAvailability(abortController.signal);
        if (available === null) throw redirect({ to: '/login', replace: true });
        if (!available) throw redirect({ to: '/onboarding', replace: true });
      }
      return { appSession: session, isStaff };
    }
    return { appSession: null, isStaff: false };
  },
  component: RootComponent,
});

/**
 * Auth route path prefixes that should skip the profile check.
 */
const AUTH_ROUTE_PREFIXES = ['/login', '/register', '/forgot-password', '/activate'];

/**
 * Routes explicitly excluded from the profile check.
 */
const EXCLUDED_ROUTES = new Set(['/', '/onboarding', '/tickets', '/support', '/terms']);
function needsProfile(pathname: string, isStaff: boolean): boolean {
  return (
    !isStaff &&
    !AUTH_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix)) &&
    !EXCLUDED_ROUTES.has(pathname) &&
    !pathname.startsWith('/onboarding/') &&
    pathname !== '/admin' &&
    !pathname.startsWith('/admin/')
  );
}

/**
 * Client-side profile check (T-03.01.01).
 *
 * After authentication, checks if the user has at least one profile.
 * Re-evaluates on every navigation so the guard catches post-onboarding
 * returns (user creates a profile in /onboarding, then navigates back).
 *
 * Routes the three cases:
 *
 * 1. No profiles → redirect to /onboarding
 * 2. Available profiles with no active context → let the user select one
 * 3. Multiple → proceed (selector shown in a separate component if needed)
 */
async function runProfileCheck(
  pathname: string,
  isStaff: boolean,
  router: ReturnType<typeof useRouter>,
  signal: AbortSignal
): Promise<void> {
  // Skip auth routes and onboarding
  if (!needsProfile(pathname, isStaff)) return;
  // App routes block rendering in their beforeLoad guard; do not repeat that request here.
  if (pathname === '/app' || pathname.startsWith('/app/')) return;

  try {
    const response = await fetch('/api/profiles', {
      method: 'GET',
      signal,
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });

    // Not authenticated — no redirect needed
    if (response.status === 401) return;
    if (!response.ok) {
      console.warn('[profile guard] non-401 response', response.status);
      return;
    }

    const data: {
      profiles: Array<{ id: string; isDefault: boolean }>;
      hasDefault: boolean;
      activeProfileId: string | null;
    } = await response.json();

    // No profiles — redirect to onboarding
    if (signal.aborted) return;
    if (data.profiles.length === 0) {
      router.navigate({ to: '/onboarding', replace: true });
      return;
    }

    // An unavailable explicit context must be selected again by the user.
    // Profile creation already establishes the initial default on the server.
    // Multiple profiles — proceed normally
  } catch (error) {
    if (!signal.aborted) console.warn('[profile guard] network error', error);
  }
}

function RootComponent() {
  const profileRevision = useProfileContextRevision();
  const router = useRouter();
  useEffect(() => {
    if (profileRevision > 0) void router.invalidate();
  }, [profileRevision, router]);
  const { pathname } = useLocation();
  const matches = useMatches();
  const isStaff = matches.some(
    (match) => (match.context as { isStaff?: unknown }).isStaff === true
  );
  const showCustomerBanner =
    !isStaff &&
    !AUTH_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix)) &&
    pathname !== '/support' &&
    pathname !== '/terms' &&
    pathname !== '/admin' &&
    !pathname.startsWith('/admin/');

  useEffect(() => {
    const controller = new AbortController();
    void runProfileCheck(pathname, isStaff, router, controller.signal);
    return () => controller.abort();
  }, [pathname, isStaff, router, profileRevision]);

  return (
    <UiDirectionProvider>
      <BrandThemeProvider key={profileRevision}>
        {showCustomerBanner && (
          <Suspense fallback={null}>
            <VerificationBanner />
          </Suspense>
        )}
        {needsProfile(pathname, isStaff) && (
          <Suspense fallback={null}>
            <DefaultProfileModal />
          </Suspense>
        )}
        <Outlet />
        <ApplicationToaster />
        {process.env.NODE_ENV === 'development' && !import.meta.env.VITE_E2E && (
          <TanStackRouterDevtools />
        )}
      </BrandThemeProvider>
    </UiDirectionProvider>
  );
}
