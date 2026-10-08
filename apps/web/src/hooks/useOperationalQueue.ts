import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccountUser } from './useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { queryKeys } from '../lib/query-keys.js';
import { ServerQueryError } from '../lib/server-query-client.js';
import { useServerListQuery } from './useServerQuery.js';
import { useCatalogueResource, useCatalogueScope } from './useCatalogueResource.js';

type QueueAccess = { canView: boolean; canRetry: boolean };
const isAccess = (value: unknown): value is QueueAccess =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  typeof (value as QueueAccess).canView === 'boolean' &&
  typeof (value as QueueAccess).canRetry === 'boolean';

/** Independent authority/queue recovery; failed navigation retains the accepted page. */
export function useOperationalQueue<T extends { id: string }>(
  endpoint: string,
  criteria: string,
  offset: number,
  validate: (value: unknown) => value is T,
  clearPrivate: () => void
) {
  const scope = useCatalogueScope(clearPrivate);
  const { live, version, denied, deny } = scope;
  const access = useCatalogueResource(scope, `${endpoint}/access`, isAccess);
  const canView = !denied && access.data?.canView === true;
  const [revision, setRevision] = useState(0);
  const accountId = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const key = JSON.stringify([
    scope.identity,
    accountId,
    profileRevision,
    version,
    endpoint,
    criteria,
  ]);
  const request = JSON.stringify([key, offset, revision]);
  const readSequence = useRef({ request, revision: 0 });
  if (readSequence.current.request !== request)
    readSequence.current = { request, revision: readSequence.current.revision + 1 };
  const [accepted, setAccepted] = useState<{
    key: string;
    request: string;
    offset: number;
    rows: T[];
    hasMore: boolean;
  } | null>(null);
  const retry = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (access.data && !access.data.canView) deny();
  }, [access.data, deny]);
  const params = new URLSearchParams(criteria);
  params.set('limit', '26');
  params.set('offset', String(offset));
  const query = useServerListQuery<{ rows: T[]; hasMore: boolean }>({
    queryKey: canView
      ? queryKeys.operations.queue(
          { context: 'staff', ownerId: scope.identity, accountId, revision: profileRevision },
          endpoint,
          params,
          version,
          readSequence.current.revision
        )
      : null,
    manual: true,
    read: async (signal) => {
      const response = await fetch(`${endpoint}?${params}`, { signal });
      if (!response.ok) throw new ServerQueryError(response.status);
      const rows: unknown = await response.json();
      if (
        !Array.isArray(rows) ||
        rows.length > 26 ||
        !rows.every(validate) ||
        new Set(rows.map((row) => row.id)).size !== rows.length
      )
        throw new Error('Invalid queue');
      return { rows: rows.slice(0, 25), hasMore: rows.length > 25 };
    },
  });
  const forbidden =
    query.error instanceof ServerQueryError &&
    (query.error.status === 401 || query.error.status === 403);
  useEffect(() => {
    if (!canView) {
      if (denied) setAccepted(null);
      return;
    }
    if (live.current !== version) return;
    if (forbidden) {
      deny();
      return;
    }
    if (query.isSuccess && !query.isFetching && !query.isPlaceholderData)
      setAccepted({ key, request, offset, rows: query.data.rows, hasMore: query.data.hasMore });
  }, [
    canView,
    denied,
    key,
    request,
    offset,
    live,
    version,
    deny,
    forbidden,
    query.isSuccess,
    query.isFetching,
    query.isPlaceholderData,
    query.data,
  ]);
  const data = canView && !forbidden && accepted?.key === key ? accepted : null;
  const loading =
    canView &&
    (query.isPending || query.isFetching || (query.isSuccess && accepted?.request !== request));
  const error = canView && query.isError;
  const ready = canView && !!data && !loading && !error && !access.loading && !access.error;
  function refresh() {
    if (denied) scope.recover();
    else {
      access.retry();
      retry();
    }
  }
  return {
    data,
    access,
    canView,
    canRetry: ready && access.data?.canRetry === true,
    ready,
    loading,
    error,
    denied,
    retry,
    refresh,
    deny,
  };
}
