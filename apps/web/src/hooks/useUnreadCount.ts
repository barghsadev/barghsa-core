import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchUnreadCount } from '../lib/notifications.js'

/** Default short-poll interval for the real-time badge (T-05.02.04). */
export const UNREAD_POLL_MS = 30_000

export interface UseUnreadCount {
  /** Latest known unread count (kept locally in sync with the server poll). */
  unreadCount: number
  /** Force an immediate poll (e.g. after an optimistic mutation settles). */
  refresh: () => void
  /** Overwrite the count with an externally-known value. */
  setUnreadCount: (count: number) => void
  /** Optimistically decrement (low-risk: read actions) without a round-trip. */
  optimisticDecrement: (by?: number) => void
}

/**
 * Real-time unread-count polling (E-05, T-05.02.04).
 *
 * Short-polls `GET /api/v1/notifications/unread-count` every `pollMs`
 * (30s by default) so the header bell badge stays current without an SSE
 * stream. Polls are guarded so a slow request never overlaps the next tick,
 * and a `visibilitychange` to visible triggers an immediate refresh so the
 * count is fresh the moment a user returns to the tab. Read actions can call
 * `optimisticDecrement` for instant feedback; the next poll reconciles with
 * the authoritative server count.
 */
export function useUnreadCount(
  pollMs: number = UNREAD_POLL_MS,
): UseUnreadCount {
  const [unreadCount, setUnreadCountState] = useState(0)
  const mounted = useRef(true)
  const inflight = useRef(false)

  const refresh = useCallback((): void => {
    if (inflight.current) return
    inflight.current = true
    void fetchUnreadCount()
      .then((count) => {
        if (mounted.current) setUnreadCountState(count)
      })
      .catch(() => {
        // Transient network/server error: keep the last known count.
      })
      .finally(() => {
        inflight.current = false
      })
  }, [])

  useEffect(() => {
    mounted.current = true
    refresh()
    const interval = window.setInterval(refresh, pollMs)
    const onVisibility = () => {
      if (!document.hidden) refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      mounted.current = false
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refresh, pollMs])

  const setUnreadCount = useCallback((count: number) => {
    if (mounted.current) setUnreadCountState(count)
  }, [])

  const optimisticDecrement = useCallback((by = 1) => {
    setUnreadCountState((prev) => Math.max(0, prev - by))
  }, [])

  return { unreadCount, refresh, setUnreadCount, optimisticDecrement }
}
