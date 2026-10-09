import { useCallback, useEffect, useId, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { commercialFetch } from '../lib/commercial-fetch.js';
import type { ServerQueryKey } from '../lib/query-keys.js';

/** Awaitable GET companions for the electricity and saving intake workspaces. */
export function useOwnedIntakeRead(identity: string) {
  const client = useQueryClient();
  const reader = useId();
  const latest = useRef(identity);
  latest.current = identity;
  const alive = useRef(true);
  const sequence = useRef(0);
  const requests = useRef(new Map<string, AbortController>());
  useEffect(() => {
    alive.current = true;
    const owned = requests.current;
    return () => {
      alive.current = false;
      for (const controller of owned.values()) controller.abort();
      owned.clear();
    };
  }, [client, identity]);
  return useCallback(
    async <T>(
      key: ServerQueryKey,
      path: string,
      failure: string,
      options: RequestInit = {}
    ): Promise<T> => {
      if (
        (options.method && options.method !== 'GET') ||
        options.body ||
        !(
          [
            '/api/profiles',
            '/api/profiles/verification-status',
            '/api/products/electricity',
            '/api/saving/plans',
            '/api/electricity/periods/simple',
          ].includes(path) ||
          /^\/api\/profiles\/[^/?]+\/addresses$/.test(path) ||
          /^\/api\/electricity\/bill-data\/[^/?]+\?period=[^&#]+$/.test(path) ||
          /^\/api\/electricity\/drafts\/simple\?profileId=[^&#]+$/.test(path)
        )
      )
        throw new Error('Invalid intake read');
      const controller = new AbortController();
      const queryKey: ServerQueryKey = [...key, JSON.stringify([reader, path, ++sequence.current])];
      const cancel = () => void client.cancelQueries({ queryKey, exact: true });
      const abort = () => controller.abort();
      controller.signal.addEventListener('abort', cancel, { once: true });
      options.signal?.addEventListener('abort', abort, { once: true });
      const previous = requests.current.get(path);
      requests.current.set(path, controller);
      previous?.abort();
      const current = () =>
        alive.current &&
        latest.current === identity &&
        requests.current.get(path) === controller &&
        !controller.signal.aborted;
      try {
        if (!current() || options.signal?.aborted) throw new Error('Obsolete intake read');
        const result = await client.fetchQuery({
          queryKey,
          staleTime: 0,
          gcTime: 0,
          retry: false,
          queryFn: async ({ signal }) => {
            const response = await commercialFetch(path, { ...options, signal });
            if (!current() || signal.aborted) throw new Error('Obsolete intake read');
            if (!response.ok) throw new Error(failure);
            const value = (await response.json()) as T;
            if (!current() || signal.aborted) throw new Error('Obsolete intake read');
            return { value };
          },
        });
        if (!current()) throw new Error('Obsolete intake read');
        return result.value;
      } finally {
        controller.signal.removeEventListener('abort', cancel);
        options.signal?.removeEventListener('abort', abort);
        if (requests.current.get(path) === controller) requests.current.delete(path);
      }
    },
    [client, identity, reader]
  );
}
