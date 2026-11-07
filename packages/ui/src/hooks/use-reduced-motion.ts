import { useSyncExternalStore } from 'react';

const query = '(prefers-reduced-motion: reduce)';
const snapshot = () =>
  typeof window === 'undefined' || !window.matchMedia || window.matchMedia(query).matches;
const subscribe = (changed: () => void) => {
  if (!window.matchMedia) return () => {};
  const media = window.matchMedia(query);
  media.addEventListener('change', changed);
  return () => media.removeEventListener('change', changed);
};

/** CSS also enforces this preference before React mounts. */
export function useReducedMotion() {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}
