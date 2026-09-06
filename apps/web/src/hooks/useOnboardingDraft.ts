import { useCallback, useEffect, useRef, useState } from 'react';
import { withCsrf } from '../lib/csrf.js';

type DraftStatus = 'loading' | 'saved' | 'saving' | 'error' | 'conflict';
export function useOnboardingDraft(
  profileId: string,
  values: Record<string, string>,
  restore: (data: Record<string, string>) => void
) {
  const [status, setStatus] = useState<DraftStatus>('loading');
  const [ready, setReady] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);
  const current = useRef(values),
    restoreRef = useRef(restore);
  current.current = values;
  restoreRef.current = restore;
  const version = useRef(0),
    saved = useRef(''),
    generation = useRef(0);
  const loaded = useRef(false),
    conflicted = useRef(false);
  const pending = useRef<Promise<number | undefined> | null>(null);
  useEffect(() => {
    const epoch = ++generation.current;
    const controller = new AbortController();
    loaded.current = false;
    conflicted.current = false;
    pending.current = null;
    setReady(false);
    setStatus('loading');
    fetch(`/api/onboarding/draft/${profileId}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Draft unavailable');
        return response.json() as Promise<{ version: number; data: Record<string, string> }>;
      })
      .then((body) => {
        if (controller.signal.aborted || epoch !== generation.current) return;
        if (
          !Number.isInteger(body.version) ||
          body.version < 0 ||
          !body.data ||
          typeof body.data !== 'object' ||
          Array.isArray(body.data)
        )
          throw new Error('Invalid draft');
        const data = Object.fromEntries(
          Object.keys(current.current).map((key) => [key, body.data[key] ?? ''])
        );
        if (Object.values(data).some((value) => typeof value !== 'string'))
          throw new Error('Invalid draft fields');
        version.current = body.version;
        saved.current = JSON.stringify(data);
        restoreRef.current(data);
        loaded.current = true;
        setReady(true);
        setStatus('saved');
      })
      .catch(() => {
        if (!controller.signal.aborted && epoch === generation.current) setStatus('error');
      });
    return () => {
      controller.abort();
      generation.current++;
      loaded.current = false;
    };
  }, [profileId, reloadCount]);

  const flush = useCallback(async (): Promise<number | undefined> => {
    const epoch = generation.current;
    if (!loaded.current || conflicted.current) return;
    while (pending.current) {
      if ((await pending.current) === undefined || epoch !== generation.current) return;
    }
    if (!loaded.current || conflicted.current || epoch !== generation.current) return;
    const snapshot = JSON.stringify(current.current);
    if (snapshot === saved.current) return version.current;
    const expectedVersion = version.current;
    setStatus('saving');
    const request = (async () => {
      try {
        const response = await fetch(`/api/onboarding/draft/${profileId}`, {
          method: 'PUT',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ expectedVersion, data: JSON.parse(snapshot) }),
        });
        if (epoch !== generation.current) return;
        if (response.status === 409) {
          conflicted.current = true;
          setStatus('conflict');
          return;
        }
        if (!response.ok) throw new Error('Draft save failed');
        const body = (await response.json()) as { version: number };
        if (epoch !== generation.current) return;
        if (body.version !== expectedVersion + 1) throw new Error('Invalid draft version');
        version.current = body.version;
        saved.current = snapshot;
        setStatus('saved');
        return body.version;
      } catch {
        if (epoch === generation.current) setStatus('error');
        return;
      }
    })();
    pending.current = request;
    try {
      return await request;
    } finally {
      if (pending.current === request) pending.current = null;
    }
  }, [profileId]);

  const serialized = JSON.stringify(values);
  useEffect(() => {
    if (!ready || serialized === saved.current || conflicted.current) return;
    const timer = setTimeout(() => {
      void flush();
    }, 1000);
    return () => clearTimeout(timer);
  }, [serialized, ready, flush]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (loaded.current && JSON.stringify(current.current) !== saved.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  const markConflict = useCallback(() => {
    conflicted.current = true;
    setStatus('conflict');
  }, []);
  return {
    markConflict,
    status:
      status === 'saved' && ready && serialized !== saved.current ? ('editing' as const) : status,
    ready,
    flush,
    reload: () => setReloadCount((value) => value + 1),
  };
}
