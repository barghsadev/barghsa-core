import { useCallback, useEffect, useState } from 'react';
import { useProfileContextRevision } from '../lib/profile-context.js';

export type AsyncData<T> =
  | { status: 'loading'; data: null; retry: () => void }
  | { status: 'error'; data: null; retry: () => void }
  | { status: 'ready'; data: T; retry: () => void };

/** Isolate a resource's retry and discard old responses immediately on profile changes. */
export function useAsyncData<T>(url: string): AsyncData<T> {
  const profileRevision = useProfileContextRevision();
  const [attempt, setAttempt] = useState(0);
  const key = `${profileRevision}:${attempt}:${url}`;
  const [result, setResult] = useState<{
    key: string;
    status: 'ready' | 'error';
    data?: T;
  } | null>(null);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(url, { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Resource unavailable');
        return response.json() as Promise<T>;
      })
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key, status: 'ready', data });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ key, status: 'error' });
      });
    return () => controller.abort();
  }, [key, url]);

  if (result?.key !== key) return { status: 'loading', data: null, retry };
  if (result.status === 'error') return { status: 'error', data: null, retry };
  return { status: 'ready', data: result.data as T, retry };
}
