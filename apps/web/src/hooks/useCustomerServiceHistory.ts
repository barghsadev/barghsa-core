import { useEffect, useRef, useState } from 'react';
import { useAccountUser } from './useAccountUser.js';
import { useCursorHistory } from './useCursorHistory.js';
import { getProfileContextRevision, useProfileContextRevision } from '../lib/profile-context.js';

type ReadState = {
  scope: string;
  status: 'loading' | 'ready' | 'error' | 'denied';
  noProfile: boolean;
};
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Retained customer pages belong to the current account, profile and query. */
export function useCustomerServiceHistory<T extends object>({
  endpoint,
  profileEndpoint = '/api/profiles',
  implicitProfile = false,
  query,
  itemsKey,
  identify,
}: {
  endpoint: string;
  profileEndpoint?: string;
  implicitProfile?: boolean;
  query: string;
  itemsKey: 'orders' | 'requests' | 'invoices';
  identify: (item: T) => string;
}) {
  const actor = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const scope = JSON.stringify([
    actor,
    profileRevision,
    endpoint,
    profileEndpoint,
    implicitProfile,
    query,
  ]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const owner = useRef<{
    actor: string | null;
    context: number;
    profile: string | null | undefined;
  }>({ actor, context: profileRevision, profile: undefined });
  const history = useCursorHistory<T & { id: string }>(scope);
  const { before, acceptPage, clear, reset } = history;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<ReadState>({ scope, status: 'loading', noProfile: false });
  const current =
    state.scope === scope ? state : { scope, status: 'loading' as const, noProfile: false };

  useEffect(() => {
    const controller = new AbortController();
    const fresh = () =>
      !controller.signal.aborted &&
      currentScope.current === scope &&
      getProfileContextRevision() === profileRevision;
    setState({ scope, status: 'loading', noProfile: false });
    const denied = (response: Response) => {
      if (![401, 403].includes(response.status)) return false;
      clear();
      setState({ scope, status: 'denied', noProfile: false });
      return true;
    };
    void (async () => {
      try {
        const response = await fetch(profileEndpoint, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (!fresh() || denied(response)) return;
        if (!response.ok) throw new Error('profile');
        const profile: unknown = await response.json();
        if (!fresh()) return;
        if (
          !record(profile) ||
          !(
            profile.activeProfileId === null ||
            (typeof profile.activeProfileId === 'string' && profile.activeProfileId.length > 0)
          )
        )
          throw new Error('profile');
        const profileId = profile.activeProfileId as string | null;
        if (!profileId) {
          owner.current = { actor, context: profileRevision, profile: null };
          clear();
          setState({ scope, status: 'ready', noProfile: true });
          return;
        }
        if (
          owner.current.actor === actor &&
          owner.current.context === profileRevision &&
          owner.current.profile !== undefined &&
          owner.current.profile !== profileId
        ) {
          owner.current = { actor, context: profileRevision, profile: profileId };
          clear();
          if (before) {
            reset();
            setRevision((value) => value + 1);
            return;
          }
        }
        owner.current = { actor, context: profileRevision, profile: profileId };
        const params = new URLSearchParams(implicitProfile ? undefined : { profileId });
        if (before) params.set('before', before);
        for (const [key, value] of new URLSearchParams(query)) params.append(key, value);
        const result = await fetch(`${endpoint}${params.size ? `?${params}` : ''}`, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (!fresh() || denied(result)) return;
        if (!result.ok) throw new Error('history');
        const value: unknown = await result.json();
        if (!fresh()) return;
        if (!record(value) || !Array.isArray(value[itemsKey])) throw new Error('history');
        const next = value.nextBefore ?? null;
        if (next !== null && typeof next !== 'string') throw new Error('cursor');
        const rows = (value[itemsKey] as T[]).map((item) => {
          if (!record(item)) throw new Error('row');
          const id = identify(item);
          if (typeof id !== 'string' || !id.length) throw new Error('row');
          return { ...item, id };
        });
        acceptPage(rows, next);
        setState({ scope, status: 'ready', noProfile: false });
      } catch {
        if (fresh()) setState({ scope, status: 'error', noProfile: false });
      }
    })();
    return () => controller.abort();
  }, [
    scope,
    actor,
    profileRevision,
    endpoint,
    profileEndpoint,
    implicitProfile,
    query,
    itemsKey,
    identify,
    before,
    revision,
    acceptPage,
    clear,
    reset,
  ]);

  const retry = () => {
    if (currentScope.current !== scope || getProfileContextRevision() !== profileRevision) return;
    if (current.status === 'denied') reset();
    setRevision((value) => value + 1);
  };
  return {
    items: history.items,
    nextBefore: history.nextBefore,
    loadMore: () => {
      if (
        currentScope.current === scope &&
        getProfileContextRevision() === profileRevision &&
        current.status === 'ready'
      )
        history.loadMore();
    },
    loading: current.status === 'loading',
    error:
      current.status === 'denied'
        ? ('denied' as const)
        : current.status === 'error'
          ? ('load' as const)
          : null,
    noProfile: current.noProfile,
    retry,
  };
}
