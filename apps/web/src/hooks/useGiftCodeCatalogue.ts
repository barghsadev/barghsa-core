import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { GiftCodeDto } from '@barghsa/shared/promotions';
import { GIFT_CODE_PAGE_SIZE, isGiftCodePage } from '../lib/gift-code-catalogue.js';
import type { useCatalogueScope } from './useCatalogueResource.js';
import { useAccountUser } from './useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { queryKeys } from '../lib/query-keys.js';
import { ServerQueryError } from '../lib/server-query-client.js';
import { useServerListQuery } from './useServerQuery.js';
import type { ListQueryBinding } from './useListQuery.js';
export function giftCodeListPath(filter: string, before?: string): string {
  const query = new URLSearchParams(filter);
  query.set('limit', String(GIFT_CODE_PAGE_SIZE));
  if (before) query.set('before', before);
  return `/api/admin/promotions/gift-codes?${query}`;
}
export function useGiftCodeCatalogue(
  scope: ReturnType<typeof useCatalogueScope>,
  filter: string,
  enabled: boolean,
  queries?: ListQueryBinding
) {
  const { live, version, denied, deny } = scope;
  const [attempt, setAttempt] = useState(0);
  const [localCursor, setLocalCursor] = useState({ filter, value: '' });
  const cursor = queries
    ? queries.query.cursor
    : localCursor.filter === filter
      ? localCursor.value
      : '';
  const reader = useId();
  const accountId = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const key = JSON.stringify([scope.identity, reader, accountId, profileRevision, version, filter]);
  const requestKey = `${key}:${cursor}`;
  const currentKey = useRef(requestKey);
  currentKey.current = requestKey;
  const sequence = useRef(0);
  const [accepted, setAccepted] = useState<{
    key: string;
    cursor: string;
    rows: GiftCodeDto[];
    next: string | null;
  } | null>(null);
  const acceptedRef = useRef(accepted);
  acceptedRef.current = accepted;
  const [state, setState] = useState<{
    requestKey: string;
    request: string;
    loading: boolean;
    error: boolean;
  } | null>(null);
  const retry = () => {
    sequence.current++;
    if (cursor && !(state?.requestKey === requestKey && state.error)) {
      if (queries) queries.setQuery({ cursor: '' });
      else setLocalCursor({ filter, value: '' });
    } else setAttempt((value) => value + 1);
  };
  const request = JSON.stringify([requestKey, attempt, denied, enabled]);
  const readOwner = useRef({ request: '', revision: 0 });
  if (readOwner.current.request !== request)
    readOwner.current = { request, revision: ++sequence.current };
  const read = readOwner.current.revision;
  const params = new URLSearchParams(filter);
  params.set('limit', String(GIFT_CODE_PAGE_SIZE));
  params.set('reader', reader);
  params.set('epoch', String(version));
  if (cursor) params.set('before', cursor);
  const query = useServerListQuery<GiftCodeDto[]>({
    queryKey:
      denied || !enabled
        ? null
        : queryKeys.catalogue.list(
            { context: 'staff', ownerId: scope.identity, accountId, revision: profileRevision },
            params,
            read
          ),
    manual: true,
    read: async (signal) => {
      const response = await fetch(giftCodeListPath(filter, cursor), { signal });
      if (!response.ok) throw new ServerQueryError(response.status);
      const data: unknown = await response.json();
      const old = acceptedRef.current;
      const extending =
        !!cursor && old?.key === key && old.next === cursor && old.cursor !== cursor;
      if (
        !isGiftCodePage(data) ||
        (data.length === GIFT_CODE_PAGE_SIZE &&
          (data.at(-1)!.id === cursor ||
            (extending && old.rows.some((row) => row.id === data.at(-1)!.id))))
      )
        throw new Error('Invalid gift codes');
      return data;
    },
  });
  const forbidden =
    read === sequence.current &&
    query.error instanceof ServerQueryError &&
    (query.error.status === 401 || query.error.status === 403);
  useEffect(() => {
    if (denied || !enabled) {
      setAccepted(null);
      setState(null);
      return;
    }
    if (live.current !== version || currentKey.current !== requestKey || read !== sequence.current)
      return;
    if (forbidden) {
      deny();
      return;
    }
    const loading = query.isPending || query.isFetching || query.isPlaceholderData;
    if (!loading && query.isSuccess) {
      const data = query.data;
      setAccepted((old) => {
        const extending =
          !!cursor && old?.key === key && old.next === cursor && old.cursor !== cursor;
        const previous = extending ? old.rows : [];
        const known = new Set(previous.map((row) => row.id));
        const next = data.length === GIFT_CODE_PAGE_SIZE ? data.at(-1)!.id : null;
        return {
          key,
          cursor,
          rows: [...previous, ...data.filter((row) => !known.has(row.id))],
          next,
        };
      });
    }
    setState({ requestKey, request, loading, error: !loading && query.isError });
  }, [
    denied,
    enabled,
    key,
    requestKey,
    request,
    cursor,
    live,
    version,
    deny,
    read,
    forbidden,
    query.isPending,
    query.isFetching,
    query.isPlaceholderData,
    query.isSuccess,
    query.isError,
    query.data,
  ]);
  const data = !denied && !forbidden && enabled && accepted?.key === key ? accepted : null;
  const status = state?.request === request ? state : null;
  const loading = enabled && !denied && (status?.loading ?? true);
  const error = status?.error ?? false;
  const more = !!cursor && !!data && data.cursor !== cursor;
  const loadMore = () => {
    if (loading || (!more && error)) return;
    if (more) {
      setAttempt((value) => value + 1);
      return;
    }
    if (!data?.next) return;
    if (queries) queries.next(data.next);
    else setLocalCursor({ filter, value: data.next });
  };
  const accept = useCallback(
    (row: GiftCodeDto) => {
      if (denied || live.current !== version || currentKey.current !== requestKey) return;
      sequence.current++;
      setAccepted((old) =>
        old?.key === key
          ? { ...old, rows: old.rows.map((item) => (item.id === row.id ? row : item)) }
          : old
      );
    },
    [denied, live, version, requestKey, key]
  );
  return {
    rows: data?.rows ?? null,
    loading: loading && !more,
    error: error && !more,
    hasMore: !!data?.next && (more || !queries || queries.canAdvance(data.next)),
    more: more
      ? loading
        ? ('loading' as const)
        : error
          ? ('error' as const)
          : ('idle' as const)
      : ('idle' as const),
    retry,
    loadMore,
    accept,
    pending: loading || error,
  };
}
