import { useCallback, useEffect, useRef, useState } from 'react';
import { ProviderRequestError } from '../lib/email-providers-api.js';
import type { useCatalogueScope } from './useCatalogueResource.js';

/** Validated provider reads retain accepted data only within the current permission epoch. */
export function useProviderCatalogue<T>(
  scope: ReturnType<typeof useCatalogueScope>,
  load: (signal: AbortSignal) => Promise<T>
) {
  const { live, version, denied, deny } = scope;
  const request = useRef<AbortController | null>(null);
  const [result, setResult] = useState<{
    version: number;
    data: T | null;
    loading: boolean;
    error: boolean;
  } | null>(null);
  const refresh = useCallback(async () => {
    request.current?.abort();
    if (denied) return;
    const controller = new AbortController();
    request.current = controller;
    const current = () => !controller.signal.aborted && live.current === version;
    setResult((previous) => ({
      version,
      data: previous?.version === version ? previous.data : null,
      loading: true,
      error: false,
    }));
    try {
      const data = await load(controller.signal);
      if (current()) setResult({ version, data, loading: false, error: false });
    } catch (error) {
      if (!current()) return;
      if (error instanceof ProviderRequestError && error.denied) {
        deny();
        return;
      }
      setResult((previous) => ({
        version,
        data: previous?.version === version ? previous.data : null,
        loading: false,
        error: true,
      }));
    }
  }, [denied, live, version, deny, load]);
  useEffect(() => {
    void refresh();
    return () => request.current?.abort();
  }, [refresh]);
  const accepted = !denied && result?.version === version ? result : null;
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
