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
const EXCLUDED_ROUTES = new Set(['/', '/onboarding'])

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
 * 2. One profile with no default → auto-set as default
 * 3. Multiple → proceed (selector shown in a separate component if needed)
 */
async function runProfileCheck(
  pathname: string,
  router: ReturnType<typeof useRouter>,
): Promise<void> {
  // Skip auth routes and onboarding
  if (AUTH_ROUTE_PREFIXES.some((p) => pathname.startsWith(p))) return
  if (EXCLUDED_ROUTES.has(pathname)) return

  try {
    const response = await fetch('/api/profiles', {
      method: 'GET',
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
    if (data.profiles.length === 0) {
      router.navigate({ to: '/onboarding', replace: true })
      return
    }

    // One profile but no default — set it as default
    if (data.profiles.length === 1 && !data.hasDefault) {
      const profile = data.profiles[0]!
      try {
        await fetch(`/api/profiles/${profile.id}/set-default`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        })
      } catch {
        // Non-critical — silently fall through
      }
      return
    }

    // Multiple profiles — proceed normally
  } catch (error) {
    console.warn('[profile guard] network error', error)
  }
}

function RootComponent() {
  const router = useRouter()
  const { pathname } = useLocation()

  useEffect(() => {
    runProfileCheck(pathname, router)
  }, [pathname, router])

  return (
    <>
      <BrandThemeProvider>
        <VerificationBanner />
        <DefaultProfileModal />
        <Outlet />
        {process.env.NODE_ENV === 'development' && <TanStackRouterDevtools />}
      </BrandThemeProvider>
    </>
  )
}