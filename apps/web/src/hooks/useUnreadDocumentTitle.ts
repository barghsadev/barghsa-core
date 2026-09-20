import { useEffect } from 'react';

/**
 * Reflect the unread count in the document title while the tab is
 * backgrounded (E-05, T-05.02.04).
 *
 * When the tab is hidden and there are unread notifications, the browser tab
 * shows `(N) <title>` so the count is visible at a glance; when the tab is
 * visible again (or the count reaches zero) the base title is restored.
 *
 * Only text written by this hook is removed. Observe branding/route changes
 * so a later title write cannot silently discard the background badge.
 */
export function useUnreadDocumentTitle(unreadCount: number, formattedCount: string): void {
  useEffect(() => {
    let base = document.title;
    let written: string | null = null;
    const apply = () => {
      if (written === null || document.title !== written) base = document.title;
      written = document.hidden && unreadCount > 0 ? `(${formattedCount}) ${base}` : base;
      if (document.title !== written) document.title = written;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    document.addEventListener('visibilitychange', apply);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', apply);
      if (document.title === written) document.title = base;
    };
  }, [unreadCount, formattedCount]);
}
