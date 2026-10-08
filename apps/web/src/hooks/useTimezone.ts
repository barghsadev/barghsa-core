import { useCallback, useEffect, useId, useState } from 'react';
import { useAccountUser } from './useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { queryKeys } from '../lib/query-keys.js';
import { useServerDetailQuery } from './useServerQuery.js';

/** Load the account preference. A failed read is never treated as a saved default. */
export function useTimezone() {
  const reader = useId();
  const accountId = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const ownerId = accountId?.trim() ? accountId : reader;
  const scope = JSON.stringify([ownerId, accountId, profileRevision]);
  const [accepted, setAccepted] = useState<{ scope: string; timezone: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision((value) => value + 1), []);
  const query = useServerDetailQuery<string>({
    queryKey: queryKeys.preferences.detail(
      { context: 'account', ownerId, accountId, revision: profileRevision },
      JSON.stringify(['timezone', revision === 0 ? 0 : [reader, revision]])
    ),
    manual: true,
    read: async (signal) => {
      const response = await fetch('/api/user/settings/timezone', { signal });
      if (!response.ok) throw new Error('Timezone unavailable');
      const data: unknown = await response.json();
      if (
        !data ||
        typeof data !== 'object' ||
        !('timezone' in data) ||
        typeof data.timezone !== 'string' ||
        !data.timezone
      )
        throw new Error('Invalid timezone response');
      new Intl.DateTimeFormat('en', { timeZone: data.timezone });
      return data.timezone;
    },
  });
  const loading = query.isPending || query.isFetching;
  const status = loading ? 'loading' : query.isError ? 'error' : 'ready';
  const timezone =
    !loading && query.isSuccess
      ? query.data
      : accepted?.scope === scope
        ? accepted.timezone
        : 'Asia/Tehran';
  useEffect(() => {
    if (!loading && query.isSuccess) setAccepted({ scope, timezone: query.data });
  }, [scope, loading, query.isSuccess, query.data]);
  useEffect(() => {
    window.addEventListener('barghsa:timezone-changed', retry);
    return () => window.removeEventListener('barghsa:timezone-changed', retry);
  }, [retry]);
  return { timezone, status, retry };
}
