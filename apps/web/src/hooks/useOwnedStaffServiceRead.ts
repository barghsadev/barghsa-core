import { useCallback, useEffect, useId, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, type ServerQueryKey } from '../lib/query-keys.js';

/** Fresh GET packets for staff electricity, consultation and solar queues. */
export function useOwnedStaffServiceRead(actor: string | null, revision: number) {
  const identity = JSON.stringify([actor, revision]);
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
    async (
      resource: 'orders' | 'contracts' | 'consultations' | 'solar' | 'catalogue',
      kind: 'list' | 'detail',
      path: string,
      external: AbortSignal
    ) => {
      const pathname = path.split('?')[0]!;
      if (
        !/^\/api\/(?:staff\/electricity\/(?:orders(?:\/(?:conversations|[^/]+))?|increase-requests|contracts\/[^/]+\/price-adjustments)|admin\/consultations\/(?:teams|requests(?:\/[^/]+)?)|admin\/solar\/(?:document-review-queue|document-guidance|requests(?:\/[^/]+\/documents)?|construction(?:\/[^/]+)?))$/.test(
          pathname
        )
      )
        throw new Error('Invalid staff read');
      const authority = {
        context: 'staff' as const,
        ownerId: actor ?? 'staff-session',
        accountId: actor,
        revision,
      };
      const url = new URL(path, 'http://barghsa.local');
      const params = new URLSearchParams(url.searchParams);
      params.set('endpoint', url.pathname);
      const key =
        kind === 'list'
          ? queryKeys[resource].list(authority, params)
          : queryKeys[resource].detail(authority, url.pathname);
      const controller = new AbortController();
      const queryKey: ServerQueryKey = [...key, JSON.stringify([reader, path, ++sequence.current])];
      const cancel = () => void client.cancelQueries({ queryKey, exact: true });
      const abort = () => controller.abort();
      controller.signal.addEventListener('abort', cancel, { once: true });
      external.addEventListener('abort', abort, { once: true });
      requests.current.add(controller);
      const current = () =>
        alive.current &&
        latest.current === identity &&
        !controller.signal.aborted &&
        !external.aborted;
      try {
        if (!current()) throw new Error('Obsolete staff read');
        const packet = await client.fetchQuery({
          queryKey,
          staleTime: 0,
          gcTime: 0,
          retry: false,
          queryFn: async ({ signal }) => {
            const response = await fetch(path, { credentials: 'include', signal });
            const data = response.ok ? ((await response.json()) as unknown) : null;
            if (!current() || signal.aborted) throw new Error('Obsolete staff read');
            return { ok: response.ok, status: response.status, data };
          },
        });
        if (!current()) throw new Error('Obsolete staff read');
        return { ok: packet.ok, status: packet.status, json: async () => packet.data };
      } finally {
        controller.signal.removeEventListener('abort', cancel);
        external.removeEventListener('abort', abort);
        requests.current.delete(controller);
      }
    },
    [client, identity, reader, actor, revision]
  );
}
