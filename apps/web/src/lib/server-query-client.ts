import { notifyManager, QueryClient } from '@tanstack/react-query';

export class ServerQueryError extends Error {
  constructor(public readonly status: number) {
    super('Server query failed');
  }
}

export const financialQueryResources = [
  'wallet',
  'invoices',
  'orders',
  'contracts',
  'payments',
  'refunds',
  'consultations',
  'saving',
  'solar',
] as const;

export function createServerQueryClient() {
  notifyManager.setScheduler(queueMicrotask);
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: (count, error) =>
          count < 2 &&
          !(
            error instanceof ServerQueryError &&
            error.status >= 400 &&
            error.status < 500 &&
            error.status !== 429
          ),
        retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 30_000),
        refetchOnWindowFocus: true,
        refetchOnMount: true,
        refetchInterval: false,
      },
      mutations: { retry: false },
    },
  });
  for (const resource of financialQueryResources) {
    client.setQueryDefaults(['barghsa', resource], {
      staleTime: 0,
      gcTime: 0,
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
      refetchInterval: false,
    });
  }
  return client;
}
