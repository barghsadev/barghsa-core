import { useCallback, useEffect, useId, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, type ServerQueryKey } from '../lib/query-keys.js';

/** Fresh native account-gate GET packets; commands retain their own owners. */
export function useOwnedGateRead(identity: string, actor: string | null, revision: number) {
  const client = useQueryClient();
  const reader = useId();
  const latest = useRef(identity);
  latest.current = identity;
  const alive = useRef(true);
  const sequence = useRef(0);
  const requests = useRef(new Set<AbortController>());
  useEffect(() => {
    alive.current = true;
    const owned = requests.current;
    return () => {
      alive.current = false;
      for (const controller of owned) controller.abort();
      owned.clear();
    };
  }, [client, identity]);
  return useCallback(
    async (path: string, options: RequestInit = {}) => {
      const url = new URL(path, 'http://barghsa.local');
      if (
        !path.startsWith('/api/') ||
        (options.method ?? 'GET') !== 'GET' ||
        options.body !== undefined ||
        !['/api/auth/user', '/api/telegram/link', '/api/tos/current'].includes(url.pathname)
      )
        throw new Error('Invalid account gate read');
      const external = options.signal;
      const authority = {
        context: 'account' as const,
        ownerId: actor ?? 'account-session',
        accountId: actor,
        revision,
      };
      const key =
        url.pathname === '/api/auth/user'
          ? queryKeys.profiles.authority(authority, path)
          : url.pathname === '/api/telegram/link'
            ? queryKeys.preferences.detail(authority, path)
            : queryKeys.catalogue.detail(authority, path);
      const controller = new AbortController();
      const queryKey: ServerQueryKey = [...key, JSON.stringify([reader, path, ++sequence.current])];
      const cancel = () => void client.cancelQueries({ queryKey, exact: true });
      const abort = () => controller.abort();
      controller.signal.addEventListener('abort', cancel, { once: true });
      external?.addEventListener('abort', abort, { once: true });
      requests.current.add(controller);
      const current = () =>
        alive.current &&
        latest.current === identity &&
        !controller.signal.aborted &&
        !external?.aborted;
      try {
        if (!current()) throw new Error('Obsolete account gate read');
        const packet = await client.fetchQuery({
          queryKey,
          staleTime: 0,
          gcTime: 0,
          retry: false,
          queryFn: async ({ signal }) => {
            const ownedSignal = external ? AbortSignal.any([external, signal]) : signal;
            const response = await fetch(path, { ...options, signal: ownedSignal });
            const data = response.ok ? ((await response.json()) as unknown) : null;
            if (!current() || signal.aborted) throw new Error('Obsolete account gate read');
            return { ok: response.ok, status: response.status, data };
          },
        });
        if (!current()) throw new Error('Obsolete account gate read');
        return { ok: packet.ok, status: packet.status, json: async () => packet.data };
      } finally {
        controller.signal.removeEventListener('abort', cancel);
        external?.removeEventListener('abort', abort);
        requests.current.delete(controller);
      }
    },
    [client, identity, reader, actor, revision]
  );
}
