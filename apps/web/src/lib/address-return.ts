export type AddressReturn = '/electricity/orders/new/advanced' | '/solar/requests/new';

declare module '@tanstack/react-router' {
  interface HistoryState {
    savedOrderAddress?: { profileId: string; id: string };
  }
}

export function addressReturnSearch(search: Record<string, unknown>): { returnTo?: AddressReturn } {
  const path = search.returnTo;
  if (path === '/electricity/advanced') return { returnTo: '/electricity/orders/new/advanced' };
  return path === '/electricity/orders/new/advanced' || path === '/solar/requests/new'
    ? { returnTo: path }
    : {};
}
