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
import { rememberSessionEnded } from '../lib/session-ended-notice.js';
import { TanStackRouterDevtools } from '@tanstack/router-devtools';
import { lazy, Suspense, useEffect, type ReactNode } from 'react';
// Auth entry routes hand off to the application before any customer workspace mounts.
const authEntry = import.meta.env.PROD && __BARGHSA_AUTH_ENTRY__;
const VerificationBanner = authEntry
  ? () => null
  : lazy(() =>
      import('../components/VerificationBanner.js').then((module) => ({
        default: module.VerificationBanner,
      }))
    );
const ProfileAvailabilityGuard = authEntry
  ? () => null
  : lazy(() =>
      import('../components/ProfileAvailabilityGuard.js').then((module) => ({
        default: module.ProfileAvailabilityGuard,
      }))
    );
const DefaultProfileModal = authEntry
  ? () => null
  : lazy(() =>
      import('../components/DefaultProfileModal.js').then((module) => ({
        default: module.DefaultProfileModal,
      }))
    );
import { UiDirectionProvider } from '../providers/UiDirectionProvider.js';
import { BrandThemeProvider } from '../providers/BrandThemeProvider.js';
import { ApplicationToaster } from '../components/ApplicationToaster.js';
import { SkipLink } from '../components/SkipLink.js';

const AuthEntryLoading = lazy(() =>
  import('../components/RouteSkeleton.js').then((module) => ({ default: module.RouteSkeleton }))
);

export const Route = createRootRoute({
  beforeLoad: async ({ location, preload, abortController }) => {
    if (import.meta.env.PROD && isAuthEntryPath(location.pathname) !== __BARGHSA_AUTH_ENTRY__) {
      if (!preload) rememberEntryLocale();
      throw redirect({ href: location.href, reloadDocument: true });
    }
    if (isAuthEntryPath(location.pathname)) {
      const session = await readSessionContext(abortController.signal);
      if (session !== null) {
        if (authEntry) return { appSession: null, isStaff: false, handoffToApp: true };
        throw redirect({ to: '/app', replace: true });
      }
    }
    if (location.pathname === '/app' || location.pathname.startsWith('/app/')) {
      const session = await readSessionContext(abortController.signal);
      if (session === null) {
        rememberSessionEnded(preload);
        throw redirect({ to: '/login', replace: true });
      }
      const isStaff = session.operatingContext === 'staff';
      if (!isStaff) {
        const available = await readProfileAvailability(
          abortController.signal,
          session.userId ?? null,
          session.navigationRevision
        );
        if (available === null) {
          rememberSessionEnded(preload);
          throw redirect({ to: '/login', replace: true });
        }
        if (!available) throw redirect({ to: '/onboarding', replace: true });
      }
      return { appSession: session, isStaff };
    }
    return { appSession: null, isStaff: false };
  },
  shellComponent: RouteShell,
  component: authEntry ? AuthEntryRoot : RootComponent,
});

function RouteShell({ children }: { children: ReactNode }) {
  return (
    <>
      <SkipLink />
      {children}
    </>
  );
}

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

function AuthEntryRoot() {
  const { handoffToApp } = Route.useRouteContext();
  // Leave the auth bundle after the root mounts so an early session response
  // cannot race the router's initial transition. The app reads authority again.
  useEffect(() => {
    if (!handoffToApp) return;
    rememberEntryLocale();
    window.location.replace('/app');
  }, [handoffToApp]);
  if (handoffToApp)
    return (
      <Suspense>
        <AuthEntryLoading />
      </Suspense>
    );
  return <RootComponent />;
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
    !authEntry &&
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
        {!authEntry && needsProfile(pathname, isStaff) && (
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
