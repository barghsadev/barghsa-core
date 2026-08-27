import { useEffect } from 'react'

/** Regex stripping a leading unread-count prefix like `(3) ` from a title. */
const UNREAD_PREFIX = /^\(\d+\)\s*/

/**
 * Reflect the unread count in the document title while the tab is
 * backgrounded (E-05, T-05.02.04).
 *
 * When the tab is hidden and there are unread notifications, the browser tab
 * shows `(N) <title>` so the count is visible at a glance; when the tab is
 * visible again (or the count reaches zero) the base title is restored.
 *
 * The base title is re-derived from `document.title` on every change by
 * stripping any existing `(N) ` prefix, so repeated updates never accumulate
 * nested prefixes.
 */
export function useUnreadDocumentTitle(unreadCount: number): void {
  useEffect(() => {
    const apply = () => {
      const base = document.title.replace(UNREAD_PREFIX, '')
      document.title =
        document.hidden && unreadCount > 0 ? `(${unreadCount}) ${base}` : base
    }
    apply()
    document.addEventListener('visibilitychange', apply)
    return () => {
      document.removeEventListener('visibilitychange', apply)
      // Always restore the clean base title on unmount.
      document.title = document.title.replace(UNREAD_PREFIX, '')
    }
  }, [unreadCount])
}
