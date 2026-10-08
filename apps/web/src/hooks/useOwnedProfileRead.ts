import { useEffect, useId, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, type ServerQueryScope } from '../lib/query-keys.js';

/** Fresh profile reads for settings commands whose confirmation must be awaitable. */
export function useOwnedProfileRead(
  identity: string,
  scope: ServerQueryScope | null,
  permitted: (identity: string) => boolean,
  denied: () => void
) {
  const client = useQueryClient();
  const reader = useId();
  const latest = useRef(identity);
  latest.current = identity;
  const alive = useRef(true);
  const sequence = useRef(0);
  const requests = useRef(new Map<string, { key: readonly unknown[]; attempt: number }>());
  useEffect(() => {
    alive.current = true;
    const owned = requests.current;
    return () => {
      alive.current = false;
      for (const request of owned.values())
        void client.cancelQueries({ queryKey: request.key, exact: true });
      owned.clear();
    };
  }, [client, identity]);
  return async (path: string, token: string): Promise<unknown> => {
    if (
      !scope ||
      token !== identity ||
      latest.current !== token ||
      !alive.current ||
      !permitted(token)
    )
      throw new Error('Obsolete profile read');
    const target = /^\/api\/profiles\/([^/]+)(\/addresses)?$/.exec(path);
    if (path !== '/api/profiles' && !target) throw new Error('Invalid profile read path');
    const attempt = ++sequence.current;
    const request = JSON.stringify([reader, path, attempt]);
    const owner = target ? { ...scope, context: 'customer' as const, ownerId: target[1]! } : scope;
    const key = target?.[2]
      ? queryKeys.profiles.list(owner, new URLSearchParams({ reader, path }), attempt)
      : target
        ? queryKeys.profiles.detail(owner, request)
        : queryKeys.profiles.authority(owner, request);
    const previous = requests.current.get(path);
    requests.current.set(path, { key, attempt });
    if (previous) await client.cancelQueries({ queryKey: previous.key, exact: true });
    const current = () =>
      alive.current &&
      latest.current === token &&
      permitted(token) &&
      requests.current.get(path)?.attempt === attempt;
    if (!current()) throw new Error('Obsolete profile read');
    try {
      // No observers or background reads: each command explicitly requests a fresh source.
      const result = await client.fetchQuery({
        queryKey: key,
        staleTime: 0,
        gcTime: 0,
        retry: false,
        queryFn: async ({ signal }) => {
          const response = await fetch(path, { credentials: 'include', signal });
          if (!current() || signal.aborted) throw new Error('Obsolete profile read');
          if ([401, 403, 404].includes(response.status)) {
            denied();
            throw new Error('Profile unavailable');
          }
          if (!response.ok) throw new Error('Profile read failed');
          const value: unknown = await response.json();
          if (!current() || signal.aborted) throw new Error('Obsolete profile read');
          return { value };
        },
      });
      if (!current()) throw new Error('Obsolete profile read');
      return result.value;
    } finally {
      if (requests.current.get(path)?.attempt === attempt) requests.current.delete(path);
    }
  };
}
