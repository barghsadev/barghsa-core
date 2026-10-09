import { useCallback, useEffect, useId, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, type ServerQueryKey } from '../lib/query-keys.js';
import { documentRequest } from '../lib/documents.js';

/** Explicit private document GETs, including audited signed-link requests. */
export function useOwnedDocumentRead(
  actor: string | null,
  revision: number,
  staff: boolean,
  profileId: string | undefined,
  readScope: string
) {
  const identity = JSON.stringify([actor, revision, staff, profileId, readScope]);
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
      const profiles = url.pathname === '/api/profiles';
      const templates = url.pathname === '/api/admin/document-templates';
      const template =
        /^\/api\/admin\/document-templates\/[^/]+(?:\/versions\/[^/]+\/files\/[^/]+\/download)?$/.test(
          url.pathname
        );
      const legal = /^\/api\/onboarding\/documents\/[^/]+$/.test(url.pathname);
      const policies = url.pathname === '/api/admin/document-retention/policies';
      const administration = /^\/api\/admin\/document-retention\/(?:holds|destruction)$/.test(
        url.pathname
      );
      const policy = /^\/api\/upload\/policy\/(?:document|contract|image|video)$/.test(
        url.pathname
      );
      const list = /^\/api\/(?:admin\/)?documents$/.test(url.pathname);
      const detail = /^\/api\/(?:admin\/)?documents\/[^/]+(?:\/(?:download|preview))?$/.test(
        url.pathname
      );
      if (
        !path.startsWith('/api/') ||
        (options.method ?? 'GET') !== 'GET' ||
        options.body !== undefined ||
        !(
          profiles ||
          policy ||
          list ||
          detail ||
          policies ||
          administration ||
          templates ||
          template ||
          legal
        )
      )
        throw new Error('Invalid document read');
      const profile = profileId?.trim() || undefined;
      const authority = {
        context: staff
          ? ('staff' as const)
          : profile
            ? ('customer' as const)
            : ('account' as const),
        ownerId: staff ? (actor ?? 'staff-session') : (profile ?? actor ?? 'account-session'),
        accountId: actor,
        revision,
      };
      const params = new URLSearchParams(url.searchParams);
      params.set('endpoint', url.pathname);
      const key = profiles
        ? queryKeys.profiles.authority(
            { ...authority, context: 'account', ownerId: actor ?? 'account-session' },
            path
          )
        : templates
          ? queryKeys.catalogue.list(authority, params)
          : template
            ? queryKeys.catalogue.detail(authority, url.pathname + url.search)
            : legal
              ? queryKeys.documents.detail(authority, url.pathname)
              : policy || policies
                ? queryKeys.catalogue.detail(authority, url.pathname)
                : list || administration
                  ? queryKeys.documents.list(authority, params)
                  : queryKeys.documents.detail(authority, url.pathname + url.search);
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
        if (!current()) throw new Error('Obsolete document read');
        const data = await client.fetchQuery({
          queryKey,
          staleTime: 0,
          gcTime: 0,
          retry: false,
          queryFn: async ({ signal }) => {
            const ownedSignal = external ? AbortSignal.any([external, signal]) : signal;
            const value = await decode(path, { ...options, signal: ownedSignal });
            if (!current() || signal.aborted) throw new Error('Obsolete document read');
            return value;
          },
        });
        if (!current()) throw new Error('Obsolete document read');
        return data;
      } finally {
        controller.signal.removeEventListener('abort', cancel);
        external?.removeEventListener('abort', abort);
        requests.current.delete(controller);
      }
    },
    [client, identity, reader, actor, revision, staff, profileId]
  );
}
