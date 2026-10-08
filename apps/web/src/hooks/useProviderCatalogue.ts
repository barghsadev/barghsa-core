import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAccountUser } from './useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { queryKeys } from '../lib/query-keys.js';
import { useServerDetailQuery } from './useServerQuery.js';
import { ProviderRequestError } from '../lib/email-providers-api.js';
import type { useCatalogueScope } from './useCatalogueResource.js';

/** Validated provider reads retain accepted data only within the current permission epoch. */
export function useProviderCatalogue<T>(
  scope: ReturnType<typeof useCatalogueScope>,
  load: (signal: AbortSignal) => Promise<T>
) {
  const { live, version, denied, deny } = scope;
  const reader = useId();
  const accountId = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const client = useQueryClient();
  const loader = useRef({ load, revision: 0 });
  if (loader.current.load !== load)
    loader.current = { load, revision: loader.current.revision + 1 };
  const queryKey = queryKeys.catalogue.detail(
    { context: 'staff', ownerId: scope.identity, accountId, revision: profileRevision },
    JSON.stringify([reader, version, loader.current.revision])
  );
  const key = JSON.stringify(queryKey);
  const latest = useRef(key);
  latest.current = key;
  const [result, setResult] = useState<{
    key: string;
    data: T | null;
    loading: boolean;
    error: boolean;
  } | null>(null);
  const query = useServerDetailQuery<{ value: T }>({
    queryKey: denied ? null : queryKey,
    manual: true,
    read: async (signal) => {
      const current = () => !signal.aborted && live.current === version && latest.current === key;
      setResult((previous) => ({
        key,
        data: previous?.key === key ? previous.data : null,
        loading: true,
        error: false,
      }));
      try {
        const data = await load(signal);
        if (current()) setResult({ key, data, loading: false, error: false });
        return { value: data };
      } catch (error) {
        if (current()) {
          if (error instanceof ProviderRequestError && error.denied) deny();
          else
            setResult((previous) => ({
              key,
              data: previous?.key === key ? previous.data : null,
              loading: false,
              error: true,
            }));
        }
        throw error;
      }
    },
  });
  const refetch = query.refetch;
  const refresh = useCallback(async () => {
    if (denied || live.current !== version || latest.current !== key) return;
    // Explicit refresh replaces a pending read, including an initial request without cached data.
    await client.cancelQueries({ queryKey: JSON.parse(key), exact: true });
    if (denied || live.current !== version || latest.current !== key) return;
    await refetch();
  }, [denied, live, version, key, client, refetch]);
  const accepted = !denied && result?.key === key ? result : null;
  return {
    data: accepted?.data ?? null,
    loading: !denied && (accepted?.loading ?? true),
    error: accepted?.error ?? false,
    refresh,
  };
}

// Object property order and changing health telemetry do not change a reviewed configuration.
export function providerBasis(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, entry]) => [key, canonical(entry)])
      );
    return item;
  };
  return JSON.stringify(canonical(value));
}

export function useProviderCommandGuard(basis: string, live: { current: number }) {
  const latest = useRef(basis),
    mounted = useRef(true);
  latest.current = basis;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return () => {
    const captured = basis,
      version = live.current;
    return () => mounted.current && latest.current === captured && live.current === version;
  };
}
