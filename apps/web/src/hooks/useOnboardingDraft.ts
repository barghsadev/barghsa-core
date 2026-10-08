import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useServerDetailQuery } from './useServerQuery.js';
import { useAccountUser } from './useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { queryKeys } from '../lib/query-keys.js';
import { withCsrf } from '../lib/csrf.js';

type DraftStatus = 'loading' | 'saved' | 'saving' | 'error' | 'conflict';
export function useOnboardingDraft(
  profileId: string,
  values: Record<string, string>,
  restore: (data: Record<string, string>) => void
) {
  const accountId = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const reader = useId();
  const client = useQueryClient();
  const identity = JSON.stringify([accountId, profileRevision, profileId]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const loadedIdentity = useRef('');
  const [status, setStatus] = useState<DraftStatus>('loading');
  const [ready, setReady] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);
  const current = useRef(values),
    restoreRef = useRef(restore);
  useLayoutEffect(() => {
    current.current = values;
    restoreRef.current = restore;
  }, [values, restore]);
  const version = useRef(0),
    saved = useRef(''),
    generation = useRef(0);
  const loaded = useRef(false),
    conflicted = useRef(false),
    submitted = useRef(false);
  const pending = useRef<Promise<number | undefined> | null>(null);
  const queryKey = queryKeys.profiles.detail(
    {
      context: 'customer',
      ownerId: profileId.trim() ? profileId : reader,
      accountId,
      revision: profileRevision,
    },
    JSON.stringify([reader, 'onboarding-draft', profileId, reloadCount])
  );
  const query = useServerDetailQuery<{ value: { version: number; data: Record<string, string> } }>({
    queryKey,
    enabled: false,
    manual: true,
    read: async (signal) => {
      const response = await fetch(`/api/onboarding/draft/${profileId}`, {
        credentials: 'include',
        signal,
      });
      if (!response.ok) throw new Error('Draft unavailable');
      return {
        value: (await response.json()) as { version: number; data: Record<string, string> },
      };
    },
  });
  useEffect(() => {
    const epoch = ++generation.current;
    const controller = new AbortController();
    loaded.current = false;
    loadedIdentity.current = '';
    conflicted.current = false;
    submitted.current = false;
    pending.current = null;
    setReady(false);
    setStatus('loading');
    query
      .refetch()
      .then((reply) => {
        if (!reply.isSuccess || !reply.data) throw new Error('Draft unavailable');
        return reply.data.value;
      })
      .then((body) => {
        if (
          controller.signal.aborted ||
          epoch !== generation.current ||
          currentIdentity.current !== identity
        )
          return;
        if (
          !Number.isInteger(body.version) ||
          body.version < 0 ||
          !body.data ||
          typeof body.data !== 'object' ||
          Array.isArray(body.data)
        )
          throw new Error('Invalid draft');
        const data = Object.fromEntries(
          Object.keys(current.current).map((key) => [
            key,
            body.data[key] ?? (key === 'documentKeys' ? '[]' : ''),
          ])
        );
        if (Object.values(data).some((value) => typeof value !== 'string'))
          throw new Error('Invalid draft fields');
        version.current = body.version;
        saved.current = JSON.stringify(data);
        restoreRef.current(data);
        loaded.current = true;
        loadedIdentity.current = identity;
        setReady(true);
        setStatus('saved');
      })
      .catch(() => {
        if (
          !controller.signal.aborted &&
          epoch === generation.current &&
          currentIdentity.current === identity
        )
          setStatus('error');
      });
    return () => {
      controller.abort();
      void client.cancelQueries({ queryKey, exact: true });
      generation.current++;
      loaded.current = false;
    };
  }, [profileId, reloadCount, identity]);

  const flush = useCallback(async (): Promise<number | undefined> => {
    const epoch = generation.current;
    if (loadedIdentity.current !== identity || currentIdentity.current !== identity) return;
    if (!loaded.current || conflicted.current || submitted.current) return;
    while (pending.current) {
      if ((await pending.current) === undefined || epoch !== generation.current) return;
    }
    if (
      !loaded.current ||
      conflicted.current ||
      submitted.current ||
      epoch !== generation.current ||
      currentIdentity.current !== identity
    )
      return;
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
        if (epoch !== generation.current || currentIdentity.current !== identity) return;
        if (response.status === 409) {
          conflicted.current = true;
          setStatus('conflict');
          return;
        }
        if (!response.ok) throw new Error('Draft save failed');
        const body = (await response.json()) as { version: number };
        if (epoch !== generation.current || currentIdentity.current !== identity) return;
        if (body.version !== expectedVersion + 1) throw new Error('Invalid draft version');
        version.current = body.version;
        saved.current = snapshot;
        setStatus('saved');
        return body.version;
      } catch {
        if (epoch === generation.current && currentIdentity.current === identity)
          setStatus('error');
        return;
      }
    })();
    pending.current = request;
    try {
      return await request;
    } finally {
      if (pending.current === request) pending.current = null;
    }
  }, [profileId, identity]);

  const serialized = JSON.stringify(values);
  useEffect(() => {
    if (!ready || serialized === saved.current || conflicted.current) return;
    const timer = setTimeout(() => {
      void flush();
    }, 1000);
    return () => clearTimeout(timer);
  }, [serialized, ready, flush]);
  const hasUnsavedChanges = useCallback(
    () =>
      loaded.current &&
      loadedIdentity.current === currentIdentity.current &&
      !submitted.current &&
      JSON.stringify(current.current) !== saved.current,
    []
  );
  const isSubmitted = useCallback(() => submitted.current, []);
  // Call only after the final submission receipt has been validated.
  const markSubmitted = useCallback(() => {
    submitted.current = true;
  }, []);
  const markConflict = useCallback(() => {
    conflicted.current = true;
    setStatus('conflict');
  }, []);
  return {
    hasUnsavedChanges,
    isSubmitted,
    markSubmitted,
    markConflict,
    status:
      status === 'saved' && ready && serialized !== saved.current ? ('editing' as const) : status,
    ready: ready && loadedIdentity.current === identity,
    flush,
    reload: () => setReloadCount((value) => value + 1),
  };
}
