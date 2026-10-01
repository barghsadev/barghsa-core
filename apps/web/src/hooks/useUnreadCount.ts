import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchUnreadCount, isNotificationDenied } from '../lib/notifications.js';

/** Default short-poll interval for the real-time badge (T-05.02.04). */
export const UNREAD_POLL_MS = 30_000;

export interface UseUnreadCount {
  /** Latest known unread count (kept locally in sync with the server poll). */
  unreadCount: number;
  /** Force an immediate poll (e.g. after an optimistic mutation settles). */
  refresh: () => void;
  /** Overwrite the count with an externally-known value. */
  setUnreadCount: (count: number) => void;
  /** Optimistically decrement (low-risk: read actions) without a round-trip. */
  optimisticDecrement: (by?: number) => void;
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
  options: { enabled?: boolean; onDenied?: () => void } = {}
): UseUnreadCount {
  const enabled = options.enabled !== false;
  const currentOptions = useRef(options);
  currentOptions.current = options;
  const [unreadCount, setUnreadCountState] = useState(0);
  const mounted = useRef(true);
  const inflight = useRef(false);
  const revision = useRef(0);
  const optimisticPending = useRef(false);

  const refresh = useCallback((): void => {
    if (currentOptions.current.enabled === false || inflight.current || optimisticPending.current)
      return;
    const started = revision.current;
    inflight.current = true;
    void fetchUnreadCount()
      .then((count) => {
        if (
          mounted.current &&
          currentOptions.current.enabled !== false &&
          revision.current === started &&
          !optimisticPending.current
        )
          setUnreadCountState(count);
      })
      .catch((error: unknown) => {
        if (
          mounted.current &&
          currentOptions.current.enabled !== false &&
          revision.current === started &&
          !optimisticPending.current &&
          isNotificationDenied(error)
        ) {
          revision.current++;
          optimisticPending.current = false;
          setUnreadCountState(0);
          currentOptions.current.onDenied?.();
        }
        // Transient failure retains the last accepted count.
      })
      .finally(() => {
        inflight.current = false;
      });
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!enabled)
      return () => {
        mounted.current = false;
      };
    refresh();
    const interval = window.setInterval(refresh, pollMs);
    const onVisibility = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mounted.current = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh, pollMs, enabled]);

  const setUnreadCount = useCallback((count: number) => {
    revision.current++;
    optimisticPending.current = false;
    if (mounted.current) setUnreadCountState(count);
  }, []);

  const optimisticDecrement = useCallback((by = 1) => {
    revision.current++;
    optimisticPending.current = true;
    setUnreadCountState((prev) => Math.max(0, prev - by));
  }, []);

  return { unreadCount, refresh, setUnreadCount, optimisticDecrement };
}
