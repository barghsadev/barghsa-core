import { useCallback, useEffect, useId, useRef } from 'react';
import { keepPreviousData, skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { sameServerList, type ServerQueryKey } from '../lib/query-keys.js';
import { financialQueryResources } from '../lib/server-query-client.js';

interface ServerRead<T> {
  queryKey: ServerQueryKey | null;
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

function readPolicy(key: ServerQueryKey | null, manual = false) {
  return manual || financialQueryResources.some((resource) => resource === key?.[1])
    ? manualRead
    : { refetchInterval: false as const };
}

export function useServerDetailQuery<T>({ queryKey, read, enabled = true, manual }: ServerRead<T>) {
  return useQuery({
    queryKey: queryKey ?? [],
    queryFn: queryKey ? ({ signal }) => read(signal) : skipToken,
    enabled: enabled && queryKey !== null,
    ...readPolicy(queryKey, manual),
  });
}

export function useServerListQuery<T>({ queryKey, read, enabled = true, manual }: ServerRead<T>) {
  return useQuery({
    queryKey: queryKey ?? [],
    queryFn: queryKey ? ({ signal }) => read(signal) : skipToken,
    enabled: enabled && queryKey !== null,
    placeholderData: (previous, previousQuery) =>
      queryKey && previousQuery && sameServerList(previousQuery.queryKey, queryKey)
        ? keepPreviousData(previous)
        : undefined,
    ...readPolicy(queryKey, manual),
  });
}

/** A fresh read for cursor windows or detail flows that already own their display and retry. */
export function useManualServerRead() {
  const client = useQueryClient();
  const reader = useId();
  const sequence = useRef(0);
  return useCallback(
    async <T>(
      key: ServerQueryKey,
      signal: AbortSignal,
      read: (signal: AbortSignal) => Promise<T>
    ) => {
      signal.throwIfAborted();
      const queryKey: ServerQueryKey = [...key, JSON.stringify([reader, ++sequence.current])];
      const cancel = () => void client.cancelQueries({ queryKey, exact: true });
      signal.addEventListener('abort', cancel, { once: true });
      try {
        const data = await client.fetchQuery({
          queryKey,
          ...manualRead,
          queryFn: ({ signal: querySignal }) => read(querySignal),
        });
        signal.throwIfAborted();
        return data;
      } finally {
        signal.removeEventListener('abort', cancel);
      }
    },
    [client, reader]
  );
}

/** Retire one-shot reads when their caller's account, profile or permission context changes. */
export function useOwnedManualServerRead(identity: string) {
  const read = useManualServerRead();
  const latest = useRef(identity);
  latest.current = identity;
  const alive = useRef(true);
  const requests = useRef(new Set<AbortController>());
  useEffect(() => {
    alive.current = true;
    const owned = requests.current;
    return () => {
      alive.current = false;
      for (const controller of owned) controller.abort();
      owned.clear();
    };
  }, [read, identity]);
  return useCallback(
    async <T>(
      key: ServerQueryKey,
      external: AbortSignal | null | undefined,
      reader: (signal: AbortSignal, current: () => boolean) => Promise<T>
    ) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      external?.addEventListener('abort', abort, { once: true });
      requests.current.add(controller);
      const current = () =>
        alive.current &&
        latest.current === identity &&
        !controller.signal.aborted &&
        !external?.aborted;
      try {
        if (!current()) throw new Error('Obsolete read');
        const packet = await read(key, controller.signal, (signal) => reader(signal, current));
        if (!current()) throw new Error('Obsolete read');
        return packet;
      } finally {
        external?.removeEventListener('abort', abort);
        requests.current.delete(controller);
      }
    },
    [read, identity]
  );
}
