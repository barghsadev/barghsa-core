import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useAccountUser } from './useAccountUser.js';
import { useServerDetailQuery } from './useServerQuery.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { queryKeys } from '../lib/query-keys.js';
import { ServerQueryError } from '../lib/server-query-client.js';

/** Shared permission boundary for the resources of one staff catalogue. */
export function useCatalogueScope(onDenied: () => void) {
  const identity = useId();
  const live = useRef(0);
  const [version, setVersion] = useState(0);
  const [denied, setDenied] = useState(false);
  const deny = useCallback(() => {
    live.current++;
    onDenied();
    setDenied(true);
    setVersion(live.current);
  }, [onDenied]);
  const recover = useCallback(() => {
    live.current++;
    setDenied(false);
    setVersion(live.current);
  }, []);
  return { identity, live, version, denied, deny, recover };
}

/** Retain accepted data on local retry; a new path or permission epoch cannot reuse it. */
export function useCatalogueResource<T>(
  scope: ReturnType<typeof useCatalogueScope>,
  path: string | null,
  validate: (value: unknown) => value is T,
  options: { onUnauthorized?: () => void } = {}
) {
  const { live, version, denied, deny } = scope;
  const { onUnauthorized } = options;
  const readIdentity = useId();
  const accountId = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const receipt = useRef<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const nextAttempt = useRef(0);
  const [result, setResult] = useState<{
    key: string;
    data: T | null;
    loading: boolean;
    error: boolean;
    readAttempt: number | null;
  } | null>(null);
  const key = JSON.stringify([scope.identity, accountId, profileRevision, version, path]);
  const request = JSON.stringify([key, attempt === 0 ? 0 : [readIdentity, attempt]]);
  const liveKey = useRef(key);
  liveKey.current = key;
  const liveRequest = useRef(request);
  liveRequest.current = request;
  const retry = useCallback(() => {
    const requested = ++nextAttempt.current;
    setAttempt(requested);
    return requested;
  }, []);
  /** Publish a validated mutation receipt before reloading its authoritative catalogue. */
  const accept = useCallback(
    (data: T) => {
      if (!path || denied || live.current !== version || liveKey.current !== key || !validate(data))
        return false;
      receipt.current = liveRequest.current;
      setResult({ key, data, loading: false, error: false, readAttempt: null });
      return true;
    },
    [path, denied, live, version, validate, key]
  );
  const query = useServerDetailQuery<unknown>({
    queryKey:
      path && !denied
        ? queryKeys.catalogue.detail(
            { context: 'account', ownerId: scope.identity, accountId, revision: profileRevision },
            request
          )
        : null,
    manual: true,
    read: async (signal) => {
      const response = await fetch(path!, { credentials: 'include', signal });
      if (!response.ok) throw new ServerQueryError(response.status);
      return response.json() as Promise<unknown>;
    },
  });
  const forbidden =
    receipt.current !== request &&
    query.error instanceof ServerQueryError &&
    (query.error.status === 401 || query.error.status === 403);
  useEffect(() => {
    if (!path || denied) {
      setResult(null);
      return;
    }
    if (live.current !== version || liveKey.current !== key || receipt.current === request) return;
    if (forbidden) {
      if (query.error instanceof ServerQueryError && query.error.status === 401) onUnauthorized?.();
      deny();
      return;
    }
    const loading = query.isPending || query.isFetching;
    if (!loading && query.isSuccess) {
      try {
        if (validate(query.data)) {
          setResult({ key, data: query.data, loading: false, error: false, readAttempt: attempt });
          return;
        }
      } catch {
        // A throwing validator is an invalid catalogue, as at the previous read boundary.
      }
    }
    setResult((previous) => ({
      key,
      data: previous?.key === key ? previous.data : null,
      loading,
      error: !loading,
      readAttempt: previous?.key === key ? previous.readAttempt : null,
    }));
  }, [
    path,
    denied,
    key,
    live,
    version,
    deny,
    attempt,
    validate,
    onUnauthorized,
    request,
    forbidden,
    query.error,
    query.isPending,
    query.isFetching,
    query.isSuccess,
    query.data,
  ]);
  const accepted = !denied && !forbidden && result?.key === key ? result : null;
  return {
    data: accepted?.data ?? null,
    loading: !!path && !denied && !forbidden && (accepted?.loading ?? true),
    error: accepted?.error ?? false,
    // Only a successful authoritative read satisfies recovery; local receipts do not.
    readAttempt: accepted?.readAttempt ?? null,
    retry,
    accept,
  };
}
