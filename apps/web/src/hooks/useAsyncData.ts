import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { loadingText } from '@barghsa/i18n/loading-feedback';
import { useAccountUser } from './useAccountUser.js';
import { useLocale } from './useLocale.js';
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
  | { status: 'error'; data: null; retry: () => void; error: AsyncReadError }
  | { status: 'ready'; data: T; retry: () => void; refreshError?: boolean };

type ReadErrorCode = 'READ_DENIED' | 'READ_UNAVAILABLE' | 'READ_FAILED';
interface AsyncReadError {
  code: ReadErrorCode;
  message: string;
}

function readErrorCode(error: unknown): ReadErrorCode {
  if (error instanceof ServerQueryError) {
    if (error.status === 401 || error.status === 403) return 'READ_DENIED';
    if (error.status === 429 || error.status >= 500) return 'READ_UNAVAILABLE';
  }
  return 'READ_FAILED';
}

export function localizedAsyncReadError(error: unknown, locale: 'en' | 'fa'): AsyncReadError {
  const code = readErrorCode(error);
  return { code, message: loadingText('readError', locale) };
}

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
  const locale = useLocale();
  const profileRevision = useProfileContextRevision();
  const accountId = useAccountUser();
  const identity = useId();
  const client = useQueryClient();
  const [attempt, setAttempt] = useState(0);
  const ownerId = accountId?.trim() ? accountId : identity;
  const scope = JSON.stringify([ownerId, accountId, profileRevision, url]);
  const key = JSON.stringify([scope, attempt === 0 ? 0 : [identity, attempt]]);
  const request = JSON.stringify([url, attempt === 0 ? 0 : [identity, attempt], parserKey(read)]);
  const [result, setResult] = useState<
    | ({ key: string; scope: string } & (
        | { status: 'ready'; data: T; refreshError?: boolean }
        | { status: 'error'; code: ReadErrorCode }
      ))
    | null
  >(null);
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
          : { key, scope, status: 'error', code: readErrorCode(query.error) }
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
    query.error,
    query.dataUpdatedAt,
    query.errorUpdatedAt,
  ]);

  if (
    result?.key !== key &&
    !(retainDataOnRefreshError && result?.scope === scope && result.status === 'ready')
  )
    return { status: 'loading', data: null, retry };
  if (result.status === 'error')
    return {
      status: 'error',
      data: null,
      retry,
      error: { code: result.code, message: loadingText('readError', locale) },
    };
  return {
    status: 'ready',
    data: result.data,
    retry,
    refreshError: result.refreshError === true,
  };
}
