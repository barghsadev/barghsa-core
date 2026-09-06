import { createRootRoute, Outlet, useLocation, useRouter } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'
import { useEffect } from 'react'
import { VerificationBanner } from '../components/VerificationBanner.js'
import { DefaultProfileModal } from '../components/DefaultProfileModal.js'
import { BrandThemeProvider } from '../providers/BrandThemeProvider.js'

export const Route = createRootRoute({
  component: RootComponent,
})

/**
 * Auth route path prefixes that should skip the profile check.
 */
const AUTH_ROUTE_PREFIXES = ['/login', '/register', '/forgot-password']

/**
 * Routes explicitly excluded from the profile check.
 */
const EXCLUDED_ROUTES = new Set(['/', '/onboarding', '/tickets'])
function needsProfile(pathname: string): boolean {
  return !AUTH_ROUTE_PREFIXES.some(prefix => pathname.startsWith(prefix)) && !EXCLUDED_ROUTES.has(pathname)
    && pathname !== '/admin' && !pathname.startsWith('/admin/')
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
  signal: AbortSignal,
): Promise<void> {
  // Skip auth routes and onboarding
  if (!needsProfile(pathname)) return

  try {
    const response = await fetch('/api/profiles', {
      method: 'GET',
      signal,
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })

    // Not authenticated — no redirect needed
    if (response.status === 401) return
    if (!response.ok) {
      console.warn('[profile guard] non-401 response', response.status)
      return
    }

    const data: {
      profiles: Array<{ id: string; isDefault: boolean }>
      hasDefault: boolean
      activeProfileId: string | null
    } = await response.json()

    // No profiles — redirect to onboarding
    if (signal.aborted) return
    if (data.profiles.length === 0) {
      router.navigate({ to: '/onboarding', replace: true })
      return
    }

    // An unavailable explicit context must be selected again by the user.
    // Profile creation already establishes the initial default on the server.
    // Multiple profiles — proceed normally
  } catch (error) {
    if (!signal.aborted) console.warn('[profile guard] network error', error)
  }
}

function RootComponent() {
  const router = useRouter()
  const { pathname } = useLocation()

  useEffect(() => {
    const controller = new AbortController()
    void runProfileCheck(pathname, router, controller.signal)
    return () => controller.abort()
  }, [pathname, router])

  return (
    <>
      <BrandThemeProvider>
        <VerificationBanner />
        {needsProfile(pathname) && <DefaultProfileModal />}
        <Outlet />
        {process.env.NODE_ENV === 'development' && <TanStackRouterDevtools />}
      </BrandThemeProvider>
    </>
  )
}