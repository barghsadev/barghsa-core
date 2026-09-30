import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import type { ListView } from '@barghsa/ui';
import { useAccountUser } from './useAccountUser.js';

const preferenceChanged = 'barghsa-list-view-changed';
function subscribeStorage(notify: () => void) {
  window.addEventListener('storage', notify);
  window.addEventListener(preferenceChanged, notify);
  return () => {
    window.removeEventListener('storage', notify);
    window.removeEventListener(preferenceChanged, notify);
  };
}
function readPreference(key: string | null): ListView | null {
  try {
    const value = key ? window.localStorage.getItem(key) : null;
    return value === 'table' || value === 'card' ? value : null;
  } catch {
    return null;
  }
}

/** Responsive until explicitly chosen; each account and history has its own preference. */
export function useListView(history: string) {
  const userId = useAccountUser();
  const key = userId ? `barghsa.list-view:${encodeURIComponent(userId)}:${history}` : null;
  const scope = key ?? `anonymous:${history}`;
  const media = useMemo(
    () => (typeof window === 'undefined' ? undefined : window.matchMedia?.('(min-width: 768px)')),
    []
  );
  const subscribeMedia = useCallback(
    (notify: () => void) => {
      media?.addEventListener('change', notify);
      return () => media?.removeEventListener('change', notify);
    },
    [media]
  );
  const desktop = useSyncExternalStore(
    subscribeMedia,
    () => media?.matches ?? false,
    () => false
  );
  const saved = useSyncExternalStore(
    subscribeStorage,
    () => readPreference(key),
    () => null
  );
  // Retain choices if storage is unavailable, without applying them to another account/history.
  const [temporary, setTemporary] = useState<{ scope: string; view: ListView } | null>(null);
  const view =
    (temporary?.scope === scope ? temporary.view : null) ?? saved ?? (desktop ? 'table' : 'card');
  function setView(next: ListView) {
    setTemporary({ scope, view: next });
    if (!key) return;
    try {
      window.localStorage.setItem(key, next);
      setTemporary(null);
      window.dispatchEvent(new Event(preferenceChanged));
    } catch {
      // A browser that denies storage can still switch views for this mounted history.
    }
  }
  return { view, setView };
}
