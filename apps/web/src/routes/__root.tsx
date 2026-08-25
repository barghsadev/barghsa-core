import { createRootRoute, Outlet, useRouter } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'
import { useEffect, useRef } from 'react'

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
    if (!response.ok) return

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
  } catch {
    // Network error — guard is non-blocking
  }
}

function RootComponent() {
  const router = useRouter()
  const checked = useRef(false)

  useEffect(() => {
    if (checked.current) return
    checked.current = true

    const pathname = window.location.pathname
    runProfileCheck(pathname, router)
  }, [router])

  return (
    <>
      <Outlet />
      {process.env.NODE_ENV === 'development' && <TanStackRouterDevtools />}
    </>
  )
}
