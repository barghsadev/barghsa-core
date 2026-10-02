import { useEffect, useRef, useSyncExternalStore } from 'react';
import { toast } from './toast-api.js';

let revision = 0;
export const getProfileContextRevision = () => revision;
const listeners = new Set<() => void>();
const resets = new Set<() => void>();
let channel: BroadcastChannel | undefined;

function invalidate() {
  // Keep a previous profile's feedback out of the newly scoped workspace.
  toast.dismiss();
  revision += 1;
  for (const reset of [...resets]) reset();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!channel && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('barghsa-profile-context');
    channel.onmessage = (event) => {
      if (event.data?.type === 'profile-changed') invalidate();
    };
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      channel?.close();
      channel = undefined;
    }
  };
}

/** Call only after the server has confirmed the selected profile. */
export function refreshProfileContext() {
  channel?.postMessage({ type: 'profile-changed' });
  invalidate();
}

/** Clear route scope before the root remount discards the page's local state. */
export function useProfileContextReset(reset: () => void) {
  const callback = useRef(reset);
  callback.current = reset;
  useEffect(() => {
    const onReset = () => callback.current();
    resets.add(onReset);
    const unsubscribe = subscribe(() => {});
    return () => {
      resets.delete(onReset);
      unsubscribe();
    };
  }, []);
}

/** Remount the scoped app tree so old requests and drafts cannot populate it. */
export function useProfileContextRevision() {
  return useSyncExternalStore(
    subscribe,
    () => revision,
    () => 0
  );
}
