import { useCallback, useEffect, useState } from 'react';
import { useProfileContextRevision } from '../lib/profile-context.js';

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
  const [attempt, setAttempt] = useState(0);
  const scope = `${profileRevision}:${url}`;
  const key = `${scope}:${attempt}`;
  const [result, setResult] = useState<{
    key: string;
    scope: string;
    refreshError?: boolean;
    status: 'ready' | 'error';
    data?: T;
  } | null>(null);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function load() {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch(url, { credentials: 'include', signal: controller.signal });
        let data: T;
        if (read) data = await read(response);
        else {
          if (!response.ok) throw new Error('Resource unavailable');
          data = (await response.json()) as T;
        }
        if (!controller.signal.aborted) setResult({ key, scope, status: 'ready', data });
      } catch {
        if (!controller.signal.aborted)
          setResult((previous) =>
            retainDataOnRefreshError && previous?.scope === scope && previous.status === 'ready'
              ? { ...previous, key, refreshError: true }
              : { key, scope, status: 'error' }
          );
      } finally {
        pending = false;
      }
    }
    void load();
    const interval =
      refreshIntervalMs > 0 ? setInterval(() => void load(), refreshIntervalMs) : null;
    return () => {
      controller.abort();
      if (interval) clearInterval(interval);
    };
  }, [key, scope, url, read, refreshIntervalMs, retainDataOnRefreshError]);

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
