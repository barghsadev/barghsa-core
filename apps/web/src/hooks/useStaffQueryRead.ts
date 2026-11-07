import { useCallback } from 'react';
import { useAccountUser } from './useAccountUser.js';
import { useOwnedManualServerRead } from './useServerQuery.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { queryKeys } from '../lib/query-keys.js';
import { ServerQueryError } from '../lib/server-query-client.js';

export async function staffQueryJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new ServerQueryError(response.status);
  return response.json();
}

/** Use for existing GET controllers that must inspect their own status, headers or receipt. */
export function useStaffQueryRead(resource: keyof typeof queryKeys) {
  const accountId = useAccountUser();
  const revision = useProfileContextRevision();
  const read = useOwnedManualServerRead(JSON.stringify([accountId, revision, resource]));
  return useCallback(
    async <T>(
      path: string,
      kind: 'list' | 'detail',
      signal: AbortSignal,
      decode: (response: Response) => Promise<T>,
      epoch = 0
    ) => {
      if (!path.startsWith('/api/')) throw new Error('Invalid staff GET');
      const scope = {
        context: 'staff' as const,
        ownerId: accountId ?? 'staff-session',
        accountId,
        revision,
      };
      const { pathname, searchParams } = new URL(path, 'https://barghsa.local');
      if (!pathname.startsWith('/api/')) throw new Error('Invalid staff GET');
      const criteria = new URLSearchParams(searchParams);
      criteria.set('endpoint', pathname);
      criteria.set('permission', String(epoch));
      const key =
        kind === 'list'
          ? queryKeys[resource].list(scope, criteria)
          : queryKeys[resource].detail(scope, JSON.stringify([path, epoch]));
      return read(key, signal, async (ownedSignal, current) => {
        const response = await fetch(path, { credentials: 'include', signal: ownedSignal });
        if (!current() || ownedSignal.aborted) throw new Error('Obsolete staff read');
        return decode(response);
      });
    },
    [accountId, revision, resource, read]
  );
}
