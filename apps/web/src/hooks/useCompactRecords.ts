import { useSyncExternalStore } from 'react';

const media = '(width < 48rem)';
function subscribe(change: () => void) {
  const query = window.matchMedia?.(media);
  query?.addEventListener('change', change);
  return () => query?.removeEventListener('change', change);
}
const read = () => window.matchMedia?.(media).matches ?? false;

/** Presentation only: keep selection, filters and commands owned by the route. */
export function useCompactRecords() {
  return useSyncExternalStore(subscribe, read, () => false);
}
