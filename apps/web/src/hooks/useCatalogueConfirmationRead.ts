import { useCallback, useEffect, useId, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAccountUser } from './useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { queryKeys, type ServerQueryKey } from '../lib/query-keys.js';
import type { useCatalogueScope } from './useCatalogueResource.js';

/** Fresh follow-up reads for verified group membership and knowledge document writes. */
export function useCatalogueConfirmationRead(scope: ReturnType<typeof useCatalogueScope>) {
  const client = useQueryClient();
  const actor = useAccountUser();
  const contextRevision = useProfileContextRevision();
  const reader = useId();
  const sequence = useRef(0);
  const alive = useRef(false);
  const active = useRef(new Set<ServerQueryKey>());
  const { identity, live, version, denied } = scope;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const key of active.current) void client.cancelQueries({ queryKey: key, exact: true });
      active.current.clear();
    };
  }, [client, identity, version, actor, contextRevision]);
  return useCallback(
    async (path: string) => {
      if (!alive.current || denied || live.current !== version)
        throw new Error('Obsolete catalogue confirmation');
      if (!/^\/api\/admin\/(?:policy-groups|kb-groups|knowledge-bases)\/[^/]+$/.test(path))
        throw new Error('Invalid catalogue confirmation path');
      const key = queryKeys.catalogue.detail(
        { context: 'staff', ownerId: identity, accountId: actor, revision: contextRevision },
        JSON.stringify([reader, 'confirmation', version, path, ++sequence.current])
      );
      active.current.add(key);
      try {
        const response = await client.fetchQuery({
          queryKey: key,
          staleTime: 0,
          gcTime: 0,
          retry: false,
          queryFn: async ({ signal }) => {
            const response = await fetch(path, { credentials: 'include', signal });
            return {
              status: response.status,
              value: response.status === 200 ? ((await response.json()) as unknown) : null,
            };
          },
        });
        if (!alive.current || live.current !== version)
          throw new Error('Obsolete catalogue confirmation');
        return response;
      } finally {
        active.current.delete(key);
      }
    },
    [client, actor, contextRevision, reader, identity, live, version, denied]
  );
}
