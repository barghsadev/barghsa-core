import { useSyncExternalStore } from 'react';

let revision = 0;
const listeners = new Set<() => void>();
let channel: BroadcastChannel | undefined;

function invalidate() {
  revision += 1;
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

/** Remount the scoped app tree so old requests and drafts cannot populate it. */
export function useProfileContextRevision() {
  return useSyncExternalStore(
    subscribe,
    () => revision,
    () => 0
  );
}
