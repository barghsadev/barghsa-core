import { useCallback, useEffect, useRef, useState } from 'react';

/** Shared permission boundary for the resources of one staff catalogue. */
export function useCatalogueScope(onDenied: () => void) {
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
  return { live, version, denied, deny, recover };
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
  const sequence = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    data: T | null;
    loading: boolean;
    error: boolean;
  } | null>(null);
  const key = `${version}:${path}`;
  const liveKey = useRef(key);
  liveKey.current = key;
  const retry = useCallback(() => setAttempt((v) => v + 1), []);
  /** Publish a validated mutation receipt before reloading its authoritative catalogue. */
  const accept = useCallback(
    (data: T) => {
      if (!path || denied || live.current !== version || liveKey.current !== key || !validate(data))
        return false;
      sequence.current++;
      setResult({ key, data, loading: false, error: false });
      return true;
    },
    [path, denied, live, version, validate, key]
  );
  useEffect(() => {
    if (!path || denied) {
      setResult(null);
      return;
    }
    const controller = new AbortController();
    const read = ++sequence.current;
    const current = () =>
      !controller.signal.aborted && live.current === version && read === sequence.current;
    setResult((previous) => ({
      key,
      data: previous?.key === key ? previous.data : null,
      loading: true,
      error: false,
    }));
    void (async () => {
      try {
        const response = await fetch(path, { signal: controller.signal });
        if (!current()) return;
        if (response.status === 401 || response.status === 403) {
          if (response.status === 401) onUnauthorized?.();
          deny();
          return;
        }
        if (!response.ok) throw new Error('Unavailable');
        const data: unknown = await response.json();
        if (!current()) return;
        if (!validate(data)) throw new Error('Invalid catalogue');
        setResult({ key, data, loading: false, error: false });
      } catch {
        if (current())
          setResult((previous) => ({
            key,
            data: previous?.key === key ? previous.data : null,
            loading: false,
            error: true,
          }));
      }
    })();
    return () => controller.abort();
  }, [path, denied, key, live, version, deny, attempt, validate, onUnauthorized]);
  const accepted = !denied && result?.key === key ? result : null;
  return {
    data: accepted?.data ?? null,
    loading: !!path && !denied && (accepted?.loading ?? true),
    error: accepted?.error ?? false,
    retry,
    accept,
  };
}
