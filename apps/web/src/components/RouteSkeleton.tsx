import { useEffect, useState } from 'react'

interface RouteSkeletonProps {
  layout?: 'default' | 'admin'
}

/**
 * Route-level loading skeleton that matches the app shell.
 * Respects prefers-reduced-motion — no animation when the user prefers it.
 */
export function RouteSkeleton({ layout = 'default' }: RouteSkeletonProps) {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setPrefersReducedMotion(mq.matches)
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const shimmer = prefersReducedMotion ? '' : 'animate-shimmer'

  if (layout === 'admin') {
    return (
      <div className="flex h-screen bg-gray-100" role="status" aria-label="Loading admin dashboard">
        {/* Sidebar skeleton */}
        <div className="w-64 bg-white border-r border-gray-200 p-4 space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={`h-4 bg-gray-200 rounded ${shimmer}`} style={{ width: `${60 + Math.random() * 30}%` }} />
          ))}
        </div>
        {/* Main content skeleton */}
        <div className="flex-1 p-8 space-y-6">
          <div className={`h-8 w-48 bg-gray-200 rounded ${shimmer}`} />
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
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
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`h-4 bg-gray-200 rounded ${shimmer}`} style={{ width: `${70 + Math.random() * 25}%` }} />
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
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

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