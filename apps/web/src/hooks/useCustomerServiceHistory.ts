import { useEffect, useRef, useState } from 'react';
import { useAccountUser } from './useAccountUser.js';
import { useCursorHistory } from './useCursorHistory.js';
import { getProfileContextRevision, useProfileContextRevision } from '../lib/profile-context.js';
import { queryKeys } from '../lib/query-keys.js';
import { ServerQueryError } from '../lib/server-query-client.js';
import { useServerDetailQuery, useServerListQuery } from './useServerQuery.js';

type ReadState = {
  scope: string;
  status: 'loading' | 'ready' | 'error' | 'denied';
  noProfile: boolean;
  key: string;
  profileId?: string;
  acceptedKey?: string;
};
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Retained customer pages belong to the current account, profile and query. */
export function useCustomerServiceHistory<T extends object>({
  resource,
  endpoint,
  profileEndpoint = '/api/profiles',
  implicitProfile = false,
  query,
  itemsKey,
  identify,
}: {
  resource: 'orders' | 'saving' | 'solar' | 'invoices';
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
    resource,
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
  const key = JSON.stringify([scope, before, revision]);
  const currentRequest = useRef(key);
  currentRequest.current = key;
  const [state, setState] = useState<ReadState>({
    scope,
    key,
    status: 'loading',
    noProfile: false,
  });
  const authority = useServerDetailQuery({
    queryKey: actor?.trim()
      ? queryKeys.profiles.authority(
          { context: 'account', ownerId: actor, accountId: actor, revision: profileRevision },
          key
        )
      : null,
    manual: true,
    read: async (signal) => {
      const fresh = () => !signal.aborted && getProfileContextRevision() === profileRevision;
      const response = await fetch(profileEndpoint, { credentials: 'include', signal });
      if (!fresh()) throw new DOMException('Abandoned profile read', 'AbortError');
      if (!response.ok) throw new ServerQueryError(response.status);
      const profile: unknown = await response.json();
      if (!fresh()) throw new DOMException('Abandoned profile read', 'AbortError');
      if (
        !record(profile) ||
        !(
          profile.activeProfileId === null ||
          (typeof profile.activeProfileId === 'string' && profile.activeProfileId.trim().length > 0)
        )
      )
        throw new Error('profile');
      return profile.activeProfileId as string | null;
    },
  });
  const authorityDenied =
    authority.isError &&
    authority.error instanceof ServerQueryError &&
    [401, 403].includes(authority.error.status);
  const profile =
    state.key === key ? state : { scope, key, status: 'loading' as const, noProfile: false };
  const profileStatus = authorityDenied
    ? 'denied'
    : authority.isError
      ? 'error'
      : authority.isPending || authority.isFetching
        ? 'loading'
        : profile.status;
  const profileId = profileStatus === 'ready' ? profile.profileId : undefined;
  useEffect(() => {
    if (
      currentRequest.current !== key ||
      getProfileContextRevision() !== profileRevision ||
      authority.isPending ||
      authority.isFetching
    )
      return;
    if (authority.isError) {
      if (authorityDenied) clear();
      setState({ scope, key, status: authorityDenied ? 'denied' : 'error', noProfile: false });
      return;
    }
    if (!authority.isSuccess) return;
    const profileId = authority.data;
    if (!profileId) {
      owner.current = { actor, context: profileRevision, profile: null };
      clear();
      setState({ scope, key, status: 'ready', noProfile: true });
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
    setState((previous) =>
      previous.key === key && previous.status === 'ready' && previous.profileId === profileId
        ? previous
        : { scope, key, status: 'ready', noProfile: false, profileId }
    );
  }, [
    actor,
    profileRevision,
    scope,
    key,
    before,
    authorityDenied,
    authority.data,
    authority.isError,
    authority.isSuccess,
    authority.isPending,
    authority.isFetching,
    clear,
    reset,
  ]);

  const params = new URLSearchParams(implicitProfile || !profileId ? undefined : { profileId });
  if (before) params.set('before', before);
  for (const [name, value] of new URLSearchParams(query)) params.append(name, value);
  const page = useServerListQuery({
    queryKey: profileId
      ? queryKeys[resource].list(
          { context: 'customer', ownerId: profileId, accountId: actor, revision: profileRevision },
          params,
          revision
        )
      : null,
    manual: true,
    read: async (signal) => {
      const fresh = () => !signal.aborted && getProfileContextRevision() === profileRevision;
      const result = await fetch(`${endpoint}${params.size ? `?${params}` : ''}`, {
        credentials: 'include',
        signal,
      });
      if (!fresh()) throw new DOMException('Abandoned history read', 'AbortError');
      if (!result.ok) throw new ServerQueryError(result.status);
      const value: unknown = await result.json();
      if (!fresh()) throw new DOMException('Abandoned history read', 'AbortError');
      if (!record(value) || !Array.isArray(value[itemsKey])) throw new Error('history');
      const next = value.nextBefore ?? null;
      if (next !== null && typeof next !== 'string') throw new Error('cursor');
      const rows = (value[itemsKey] as T[]).map((item) => {
        if (!record(item)) throw new Error('row');
        const id = identify(item);
        if (typeof id !== 'string' || !id.length) throw new Error('row');
        return { ...item, id };
      });
      return { rows, next };
    },
  });
  const pageDenied =
    profileId &&
    page.isError &&
    page.error instanceof ServerQueryError &&
    [401, 403].includes(page.error.status);
  useEffect(() => {
    if (currentRequest.current !== key || getProfileContextRevision() !== profileRevision) return;
    if (pageDenied) {
      clear();
      setState({ scope, key, status: 'denied', noProfile: false });
    } else if (
      profileId &&
      page.data &&
      !page.isFetching &&
      !page.isError &&
      !page.isPlaceholderData
    ) {
      acceptPage(page.data.rows, page.data.next);
      setState((previous) => (previous.key === key ? { ...previous, acceptedKey: key } : previous));
    }
  }, [
    pageDenied,
    profileId,
    page.data,
    page.isFetching,
    page.isError,
    page.isPlaceholderData,
    clear,
    acceptPage,
    scope,
    key,
    profileRevision,
  ]);
  const status =
    pageDenied || authorityDenied
      ? 'denied'
      : !profileId
        ? profileStatus
        : page.isPending || page.isFetching || page.isPlaceholderData
          ? 'loading'
          : page.isError
            ? 'error'
            : state.acceptedKey === key
              ? 'ready'
              : 'loading';

  const retry = () => {
    if (currentScope.current !== scope || getProfileContextRevision() !== profileRevision) return;
    if (status === 'denied') reset();
    setRevision((value) => value + 1);
  };
  return {
    items: status === 'denied' ? [] : history.items,
    nextBefore: status === 'denied' ? null : history.nextBefore,
    loadMore: () => {
      if (
        currentScope.current === scope &&
        getProfileContextRevision() === profileRevision &&
        status === 'ready'
      )
        history.loadMore();
    },
    loading: status === 'loading',
    error:
      status === 'denied' ? ('denied' as const) : status === 'error' ? ('load' as const) : null,
    noProfile: profileStatus === 'ready' && profile.noProfile,
    retry,
  };
}
