import type { HistoryState } from '@tanstack/react-router';

export function takeSavedOrderAddress(profileId: string, addresses: readonly { id: string }[]) {
  const state = window.history.state as HistoryState | null;
  if (!state?.savedOrderAddress) return undefined;
  const { savedOrderAddress, ...remaining } = state;
  window.history.replaceState(remaining, '');
  return savedOrderAddress.profileId === profileId &&
    addresses.some(({ id }) => id === savedOrderAddress.id)
    ? savedOrderAddress.id
    : undefined;
}
