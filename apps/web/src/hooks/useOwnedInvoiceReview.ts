import { useCallback, useEffect, useId, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, type ServerQueryKey } from '../lib/query-keys.js';

/** Explicit readonly invoice POST previews. Never accepts command endpoints. */
export function useOwnedInvoiceReview(actor: string | null, revision: number) {
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
    async (path: string, init: RequestInit, decodeErrors = false) => {
      if (
        !/^\/api\/admin\/invoices\/(?:manual\/review|[^/?]+\/corrections\/review|bank-receipts\/[^/?]+\/confirm\/review)$/.test(
          path
        ) ||
        init.method !== 'POST'
      )
        throw new Error('Invalid invoice review');
      const authority = {
        context: 'staff' as const,
        ownerId: actor ?? 'staff-session',
        accountId: actor,
        revision,
      };
      const queryKey: ServerQueryKey = [
        ...queryKeys.invoices.detail(authority, path),
        JSON.stringify([reader, ++sequence.current]),
      ];
      const controller = new AbortController();
      const cancel = () => void client.cancelQueries({ queryKey, exact: true });
      const abort = () => controller.abort();
      const external = init.signal;
      controller.signal.addEventListener('abort', cancel, { once: true });
      external?.addEventListener('abort', abort, { once: true });
      requests.current.add(controller);
      const current = () =>
        alive.current &&
        latest.current === identity &&
        !controller.signal.aborted &&
        !external?.aborted;
      try {
        if (!current()) throw new Error('Obsolete invoice review');
        const packet = await client.fetchQuery({
          queryKey,
          staleTime: 0,
          gcTime: 0,
          retry: false,
          queryFn: async ({ signal }) => {
            const response = await fetch(path, { ...init, signal });
            const data = response.ok || decodeErrors ? ((await response.json()) as unknown) : null;
            if (!current() || signal.aborted) throw new Error('Obsolete invoice review');
            return { ok: response.ok, status: response.status, data };
          },
        });
        if (!current()) throw new Error('Obsolete invoice review');
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
