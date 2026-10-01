import { useCallback, useEffect, useRef } from 'react';
const eventName = 'barghsa:notification-access-denied';
/** Clear the inbox and bell together, without crossing operating contexts. */
export function useNotificationAccessDenied(context: 'staff' | 'customer', clear: () => void) {
  const source = useRef({}),
    latest = useRef({ context, clear });
  latest.current = { context, clear };
  useEffect(() => {
    const denied = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.context === latest.current.context && detail.source !== source.current)
        latest.current.clear();
    };
    window.addEventListener(eventName, denied);
    return () => window.removeEventListener(eventName, denied);
  }, []);
  return useCallback(() => {
    latest.current.clear();
    window.dispatchEvent(
      new CustomEvent(eventName, {
        detail: { context: latest.current.context, source: source.current },
      })
    );
  }, []);
}
