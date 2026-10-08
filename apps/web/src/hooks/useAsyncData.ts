import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAccountUser } from './useAccountUser.js';
import { useServerDetailQuery } from './useServerQuery.js';
import { queryKeys } from '../lib/query-keys.js';
import { financialQueryResources, ServerQueryError } from '../lib/server-query-client.js';
import { useProfileContextRevision } from '../lib/profile-context.js';

const parserKeys = new WeakMap<(response: Response) => Promise<unknown>, number>();
let nextParserKey = 0;
function parserKey(read?: (response: Response) => Promise<unknown>) {
  if (!read) return 0;
  let key = parserKeys.get(read);
  if (key === undefined) {
    key = ++nextParserKey;
    parserKeys.set(read, key);
  }
  return key;
}
const transports = new WeakMap<object, AbortController>();

export type AsyncData<T> =
  | { status: 'loading'; data: null; retry: () => void }
  | { status: 'error'; data: null; retry: () => void }
  | { status: 'ready'; data: T; retry: () => void; refreshError?: boolean };

/** Isolate a resource's retry and discard old responses immediately on profile changes. */
export function useAsyncData<T>(
  url: string,
  {
    read,
    refreshIntervalMs = 0,
    retainDataOnRefreshError = false,
  }: {
    read?: (response: Response) => Promise<T>;
    refreshIntervalMs?: number;
    retainDataOnRefreshError?: boolean;
  } = {}
): AsyncData<T> {
  const profileRevision = useProfileContextRevision();
  const accountId = useAccountUser();
  const identity = useId();
  const client = useQueryClient();
  const [attempt, setAttempt] = useState(0);
  const ownerId = accountId?.trim() ? accountId : identity;
  const scope = JSON.stringify([ownerId, accountId, profileRevision, url]);
  const key = JSON.stringify([scope, attempt === 0 ? 0 : [identity, attempt]]);
  const request = JSON.stringify([url, attempt === 0 ? 0 : [identity, attempt], parserKey(read)]);
  const [result, setResult] = useState<{
    key: string;
    scope: string;
    refreshError?: boolean;
    status: 'ready' | 'error';
    data?: T;
  } | null>(null);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  const queryKey = useMemo(
    () =>
      queryKeys.profiles.detail(
        { context: 'account', ownerId, accountId, revision: profileRevision },
        request
      ),
    [ownerId, accountId, profileRevision, request]
  );
  const query = useServerDetailQuery<{ value: T }>({
    queryKey,
    manual: true,
    read: async (signal) => {
      const current = client.getQueryCache().find({ queryKey, exact: true });
      const controller = new AbortController();
      if (current) {
        transports.get(current)?.abort();
        transports.set(current, controller);
      }
      const abort = () => controller.abort();
      if (signal.aborted) abort();
      signal.addEventListener('abort', abort, { once: true });
      try {
        const response = await fetch(url, { credentials: 'include', signal: controller.signal });
        if (read) return { value: await read(response) };
        if (!response.ok) throw new ServerQueryError(response.status);
        return { value: (await response.json()) as T };
      } finally {
        signal.removeEventListener('abort', abort);
      }
    },
  });
  useEffect(() => {
    const current = client.getQueryCache().find({ queryKey, exact: true });
    return () => {
      if (current && current.getObserversCount() === 0) transports.get(current)?.abort();
    };
  }, [client, queryKey]);
  const financial =
    url !== '/api/admin/wallet/chargebacks/unresolved-warning' &&
    financialQueryResources.some((resource) => url.split(/[/?]/).includes(resource));
  useEffect(() => {
    if (refreshIntervalMs <= 0 || financial) return;
    const interval = setInterval(
      () => void query.refetch({ cancelRefetch: false }),
      refreshIntervalMs
    );
    return () => clearInterval(interval);
  }, [request, refreshIntervalMs, financial, query.refetch]);
  useEffect(() => {
    if (query.isFetching || query.isPending) return;
    if (query.isSuccess) setResult({ key, scope, status: 'ready', data: query.data.value });
    else if (query.isError)
      setResult((previous) =>
        retainDataOnRefreshError && previous?.scope === scope && previous.status === 'ready'
          ? { ...previous, key, refreshError: true }
          : { key, scope, status: 'error' }
      );
  }, [
    key,
    scope,
    retainDataOnRefreshError,
    query.isFetching,
    query.isPending,
    query.isSuccess,
    query.isError,
    query.data,
    query.dataUpdatedAt,
    query.errorUpdatedAt,
  ]);

  if (
    result?.key !== key &&
    !(retainDataOnRefreshError && result?.scope === scope && result.status === 'ready')
  )
    return { status: 'loading', data: null, retry };
  if (result.status === 'error') return { status: 'error', data: null, retry };
  return {
    status: 'ready',
    data: result.data as T,
    retry,
    refreshError: result.refreshError === true,
  };
}
