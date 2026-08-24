import { useEffect, useState } from 'react'

interface RouteSkeletonProps {
  layout?: 'default' | 'admin'
}

/**
 * Synchronously evaluate prefers-reduced-motion so SSR and first paint match.
 * Falls back to false when matchMedia is unavailable (SSR/server context).
 */
function getPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Deterministic skeleton widths to avoid hydration mismatches.
 */
const DEFAULT_SKELETON_WIDTHS = ['70%', '85%', '60%', '75%'] as const
const ADMIN_SIDEBAR_WIDTHS = ['70%', '50%', '80%', '55%', '65%', '75%'] as const

/**
 * Route-level loading skeleton that matches the app shell.
 * Respects prefers-reduced-motion — no animation when the user prefers it.
 * Uses logical CSS properties for RTL compatibility.
 */
export function RouteSkeleton({ layout = 'default' }: RouteSkeletonProps) {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(getPrefersReducedMotion)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    // Sync any change that happened after initial render
    setPrefersReducedMotion(mq.matches)
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const shimmer = prefersReducedMotion ? '' : 'animate-shimmer'

  if (layout === 'admin') {
    return (
      <div className="flex h-screen bg-gray-100" role="status" aria-label="Loading admin dashboard">
        {/* Sidebar skeleton — uses logical border for RTL */}
        <div className="w-64 bg-white border-inset-end border-gray-200 p-4 space-y-4 shrink-0">
          {ADMIN_SIDEBAR_WIDTHS.map((width, i) => (
            <div key={i} className={`h-4 bg-gray-200 rounded ${shimmer}`} style={{ width }} />
          ))}
        </div>
        {/* Main content skeleton */}
        <div className="flex-1 p-8 space-y-6">
          <div className={`h-8 w-48 bg-gray-200 rounded ${shimmer}`} />
          <div className="grid grid-cols-3 gap-4">
            {[1, 2, 3].map((_, i) => (
              <div key={i} className={`h-32 bg-gray-200 rounded-lg ${shimmer}`} />
            ))}
          </div>
          <div className={`h-64 w-full bg-gray-200 rounded-lg ${shimmer}`} />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white" role="status" aria-label="Loading page">
      <div className="max-w-4xl mx-auto p-8 space-y-6">
        <div className={`h-8 w-48 bg-gray-200 rounded ${shimmer}`} />
        <div className="space-y-3">
          {DEFAULT_SKELETON_WIDTHS.map((width, i) => (
            <div key={i} className={`h-4 bg-gray-200 rounded ${shimmer}`} style={{ width }} />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Minimal spinner for inline loading states (e.g. route transitions).
 * Respects prefers-reduced-motion.
 */
export function RouteSpinner() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(getPrefersReducedMotion)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setPrefersReducedMotion(mq.matches)
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return (
    <div className="flex items-center justify-center min-h-[200px]" role="status" aria-label="Loading">
      {prefersReducedMotion ? (
        <span className="text-gray-400 text-sm">Loading…</span>
      ) : (
        <div className="w-8 h-8 border-4 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
      )}
    </div>
  )
}