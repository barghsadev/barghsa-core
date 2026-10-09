import { useCallback, useEffect, useId, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, type ServerQueryKey } from '../lib/query-keys.js';
import { documentRequest } from '../lib/documents.js';

/** Contract contexts and explicit readonly signing previews retain their native parsers. */
export function useOwnedContractRead(
  actor: string | null,
  revision: number,
  profileId: string | undefined,
  readScope: string
) {
  const identity = JSON.stringify([actor, revision, profileId, readScope]);
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
    async <T>(
      path: string,
      options: RequestInit = {},
      decode: (path: string, options: RequestInit) => Promise<T> = documentRequest<T>
    ): Promise<T> => {
      const url = new URL(path, 'http://barghsa.local');
      const method = options.method ?? 'GET';
      const documents = /^\/api\/(?:admin\/)?documents$/.test(url.pathname);
      const collection = /^\/api\/(?:admin\/)?contracts$/.test(url.pathname);
      const history = /^\/api\/(?:admin\/)?contracts\/[^/]+\/versions$/.test(url.pathname);
      const recordPath = /^\/api\/(?:admin\/)?contracts\/[^/]+(?:\/versions(?:\/[^/]+)?)?$/.test(
        url.pathname
      );
      const increase = /^\/api\/electricity\/contracts\/[^/]+\/increase$/.test(url.pathname);
      const config = url.pathname === '/api/admin/contract-activation-rules';
      const obligations = url.pathname === '/api/admin/wallet-refunds/contract-obligations';
      const refundPreview =
        /^\/api\/admin\/(?:wallet-refunds\/[^/]+\/process|external-refunds\/[^/]+\/(?:record-transfer|reconcile))\/review$/.test(
          url.pathname
        );
      const list =
        url.pathname === '/api/admin/contracts/authoring-options' ||
        url.pathname === '/api/admin/contract-cancellation-requests' ||
        documents ||
        collection ||
        history ||
        obligations;
      const permitted =
        method === 'GET'
          ? collection ||
            recordPath ||
            increase ||
            config ||
            obligations ||
            url.pathname === '/api/admin/contracts/authoring-options' ||
            url.pathname === '/api/admin/contract-cancellation-requests' ||
            /^\/api\/(?:admin\/)?contracts\/[^/]+\/(?:activation|signature|acceptance-review|cancellation-status|cancellation-requests)$/.test(
              url.pathname
            ) ||
            /^\/api\/admin\/contracts\/[^/]+\/(?:cancellation-preview|cancellations)$/.test(
              url.pathname
            ) ||
            (documents &&
              url.searchParams.get('businessRecordType') === 'contract' &&
              !!url.searchParams.get('businessRecordId') &&
              !!url.searchParams.get('contractVersionId') &&
              url.searchParams.get('state') === 'Approved')
          : method === 'POST' &&
            (/^\/api\/(?:admin\/)?contracts\/[^/]+\/signature\/review$/.test(url.pathname) ||
              refundPreview);
      if (!path.startsWith('/api/') || !permitted) throw new Error('Invalid contract read');
      const staff = url.pathname.startsWith('/api/admin/');
      const authority = {
        context: staff
          ? ('staff' as const)
          : profileId
            ? ('customer' as const)
            : ('account' as const),
        ownerId: staff ? (actor ?? 'staff-session') : (profileId ?? actor ?? 'account-session'),
        accountId: actor,
        revision,
      };
      const params = new URLSearchParams(url.searchParams);
      params.set('endpoint', url.pathname);
      const key = list
        ? queryKeys.contracts.list(authority, params)
        : config
          ? queryKeys.catalogue.detail(authority, url.pathname + url.search)
          : queryKeys.contracts.detail(authority, url.pathname + url.search);
      const queryKey: ServerQueryKey = [...key, JSON.stringify([reader, ++sequence.current])];
      const controller = new AbortController();
      const external = options.signal;
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
        if (!current()) throw new Error('Obsolete contract read');
        const data = await client.fetchQuery({
          queryKey,
          staleTime: 0,
          gcTime: 0,
          retry: false,
          queryFn: async ({ signal }) => {
            const ownedSignal = external ? AbortSignal.any([external, signal]) : signal;
            const value = await decode(path, { ...options, signal: ownedSignal });
            if (!current() || signal.aborted) throw new Error('Obsolete contract read');
            return value;
          },
        });
        if (!current()) throw new Error('Obsolete contract read');
        return data;
      } finally {
        controller.signal.removeEventListener('abort', cancel);
        external?.removeEventListener('abort', abort);
        requests.current.delete(controller);
      }
    },
    [client, identity, reader, actor, revision, profileId]
  );
}
