import { useProfileContextRevision } from '../lib/profile-context.js';
import { createRootRoute, Outlet, useLocation, useRouter } from '@tanstack/react-router';
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
  component: RootComponent,
});

/**
 * Auth route path prefixes that should skip the profile check.
 */
const AUTH_ROUTE_PREFIXES = ['/login', '/register', '/forgot-password', '/activate'];

/**
 * Routes explicitly excluded from the profile check.
 */
const EXCLUDED_ROUTES = new Set(['/', '/onboarding', '/tickets']);
function needsProfile(pathname: string): boolean {
  return (
    !AUTH_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix)) &&
    !EXCLUDED_ROUTES.has(pathname) &&
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
  router: ReturnType<typeof useRouter>,
  signal: AbortSignal
): Promise<void> {
  // Skip auth routes and onboarding
  if (!needsProfile(pathname)) return;

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
  const { pathname } = useLocation();

  useEffect(() => {
    const controller = new AbortController();
    void runProfileCheck(pathname, router, controller.signal);
    return () => controller.abort();
  }, [pathname, router, profileRevision]);

  return (
    <UiDirectionProvider>
      <BrandThemeProvider key={profileRevision}>
        {!AUTH_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix)) && (
          <Suspense fallback={null}>
            <VerificationBanner />
          </Suspense>
        )}
        {needsProfile(pathname) && (
          <Suspense fallback={null}>
            <DefaultProfileModal />
          </Suspense>
        )}
        <Outlet />
        <ApplicationToaster />
        {process.env.NODE_ENV === 'development' && <TanStackRouterDevtools />}
      </BrandThemeProvider>
    </UiDirectionProvider>
  );
}
