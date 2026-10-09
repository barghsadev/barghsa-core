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
const ProfileAvailabilityGuard = lazy(() =>
  import('../components/ProfileAvailabilityGuard.js').then((module) => ({
    default: module.ProfileAvailabilityGuard,
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
        const available = await readProfileAvailability(
          abortController.signal,
          session.userId ?? null,
          session.navigationRevision
        );
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

function RootComponent() {
  const profileRevision = useProfileContextRevision();
  const router = useRouter();
  useEffect(() => {
    if (profileRevision > 0) void router.invalidate();
  }, [profileRevision, router]);
  const { pathname } = useLocation();
  const matches = useMatches();
  const accountId =
    matches
      .map(
        (match) => match.context as { userId?: unknown; appSession?: { userId?: unknown } | null }
      )
      .map((context) => context.userId ?? context.appSession?.userId)
      .find((id): id is string => typeof id === 'string' && !!id.trim()) ?? null;
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

  return (
    <UiDirectionProvider>
      <BrandThemeProvider key={profileRevision}>
        {showCustomerBanner && (
          <Suspense fallback={null}>
            <VerificationBanner accountId={accountId} />
          </Suspense>
        )}
        {needsProfile(pathname, isStaff) && (
          <Suspense fallback={null}>
            <ProfileAvailabilityGuard
              accountId={accountId}
              pathname={pathname}
              revision={profileRevision}
            />
            <DefaultProfileModal accountId={accountId} />
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
