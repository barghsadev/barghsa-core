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
  validate: (value: unknown) => value is T
) {
  const { live, version, denied, deny } = scope;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    data: T | null;
    loading: boolean;
    error: boolean;
  } | null>(null);
  const key = `${version}:${path}`;
  const retry = useCallback(() => setAttempt((v) => v + 1), []);
  useEffect(() => {
    if (!path || denied) {
      setResult(null);
      return;
    }
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && live.current === version;
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
  }, [path, denied, key, live, version, deny, attempt, validate]);
  const accepted = !denied && result?.key === key ? result : null;
  return {
    data: accepted?.data ?? null,
    loading: !!path && !denied && (accepted?.loading ?? true),
    error: accepted?.error ?? false,
    retry,
  };
}
