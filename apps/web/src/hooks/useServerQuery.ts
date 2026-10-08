import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { sameServerList, type ServerQueryKey } from '../lib/query-keys.js';
import { financialQueryResources } from '../lib/server-query-client.js';

interface ServerRead<T> {
  queryKey: ServerQueryKey;
  read: (signal: AbortSignal) => Promise<T>;
  enabled?: boolean;
  manual?: boolean;
}

const manualRead = {
  staleTime: 0,
  gcTime: 0,
  retry: false,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  refetchInterval: false,
} as const;

function readPolicy(key: ServerQueryKey, manual = false) {
  return manual || financialQueryResources.some((resource) => resource === key[1])
    ? manualRead
    : { refetchInterval: false as const };
}

export function useServerDetailQuery<T>({ queryKey, read, enabled = true, manual }: ServerRead<T>) {
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => read(signal),
    enabled,
    ...readPolicy(queryKey, manual),
  });
}

export function useServerListQuery<T>({ queryKey, read, enabled = true, manual }: ServerRead<T>) {
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => read(signal),
    enabled,
    placeholderData: (previous, previousQuery) =>
      previousQuery && sameServerList(previousQuery.queryKey, queryKey)
        ? keepPreviousData(previous)
        : undefined,
    ...readPolicy(queryKey, manual),
  });
}
