import { useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAccountUser } from './useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { queryKeys } from '../lib/query-keys.js';
import { useServerListQuery } from './useServerQuery.js';
import { usePreferenceSettingsOwner } from './usePreferenceSettingsForm.js';
import {
  securitySessions,
  securityTrustedDevices,
  type SecuritySession,
  type TrustedDevice,
} from '../lib/security-settings-form.js';
export type SecurityOwner = ReturnType<typeof usePreferenceSettingsOwner>;
export function useSecuritySettingsLists(scope: SecurityOwner) {
  const reader = useId();
  const accountId = useAccountUser();
  const revision = useProfileContextRevision();
  const client = useQueryClient();
  const epoch = useRef({ key: scope.key, value: 0 });
  if (epoch.current.key !== scope.key)
    epoch.current = { key: scope.key, value: epoch.current.value + 1 };
  const keyFor = (family: 'sessions' | 'devices') =>
    queryKeys.preferences.list(
      { context: 'account', ownerId: scope.key, accountId, revision },
      new URLSearchParams({ reader, family }),
      epoch.current.value
    );
  const refreshSequence = useRef({ sessions: 0, devices: 0 });
  const accepted = useRef({ sessions: [] as SecuritySession[], devices: [] as TrustedDevice[] });
  const sequence = useRef({ sessions: 0, devices: 0 });
  const [data, setData] = useState({ key: scope.key, ...accepted.current });
  const [loading, setLoading] = useState({ sessions: true, devices: true });
  const [failed, setFailed] = useState({ sessions: false, devices: false });
  async function load(family: 'sessions' | 'devices', signal: AbortSignal) {
    const attempt = ++sequence.current[family];
    setLoading((v) => ({ ...v, [family]: true }));
    setFailed((v) => ({ ...v, [family]: false }));
    try {
      const response = await fetch(
        '/api/auth/' + (family === 'sessions' ? 'sessions' : 'trusted-devices'),
        {
          credentials: 'include',
          signal,
        }
      );
      if (!scope.isCurrent() || signal?.aborted || attempt !== sequence.current[family])
        return { ok: false, attempt };
      if ([401, 403].includes(response.status)) {
        scope.deny();
        return { ok: false, attempt };
      }
      if (!response.ok) throw new Error('Unavailable source');
      const body: unknown = await response.json();
      if (!scope.isCurrent() || signal?.aborted || attempt !== sequence.current[family])
        return { ok: false, attempt };
      if (family === 'sessions') {
        const rows = securitySessions(body);
        if (!rows) throw new Error('Invalid source');
        accepted.current = { ...accepted.current, sessions: rows };
      } else {
        const rows = securityTrustedDevices(body);
        if (!rows) throw new Error('Invalid source');
        accepted.current = { ...accepted.current, devices: rows };
      }
      setData({ key: scope.key, ...accepted.current });
      return { ok: true, attempt };
    } catch {
      if (scope.isCurrent() && !signal?.aborted && attempt === sequence.current[family])
        setFailed((v) => ({ ...v, [family]: true }));
      return { ok: false, attempt };
    } finally {
      if (scope.isCurrent() && !signal?.aborted && attempt === sequence.current[family])
        setLoading((v) => ({ ...v, [family]: false }));
    }
  }
  const active = useRef(scope);
  active.current = scope;
  useEffect(() => {
    sequence.current.sessions++;
    sequence.current.devices++;
    accepted.current = { sessions: [], devices: [] };
    setData({ key: scope.key, ...accepted.current });
    setFailed({ sessions: false, devices: false });
    if (!active.current.isCurrent()) {
      setLoading({ sessions: false, devices: false });
      return;
    }
    setLoading({ sessions: true, devices: true });
    return () => {
      sequence.current.sessions++;
      sequence.current.devices++;
      refreshSequence.current.sessions++;
      refreshSequence.current.devices++;
    };
  }, [scope.key, scope.denied]);
  const sessions = useServerListQuery({
    queryKey: accountId && !scope.denied ? keyFor('sessions') : null,
    manual: true,
    read: (signal) => load('sessions', signal),
  });
  const devices = useServerListQuery({
    queryKey: accountId && !scope.denied ? keyFor('devices') : null,
    manual: true,
    read: (signal) => load('devices', signal),
  });
  async function read(family: 'sessions' | 'devices', signal?: AbortSignal) {
    if (!scope.isCurrent() || signal?.aborted) return false;
    const request = ++refreshSequence.current[family];
    const baseline = sequence.current[family];
    const queryKey = keyFor(family);
    const current = () =>
      scope.isCurrent() && !signal?.aborted && refreshSequence.current[family] === request;
    // Revocation checks require a new read, even while an initial read is still pending.
    await client.cancelQueries({ queryKey, exact: true });
    if (!current()) return false;
    const abort = () => {
      if (scope.isCurrent() && refreshSequence.current[family] === request)
        void client.cancelQueries({ queryKey, exact: true });
    };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const result = await (family === 'sessions' ? sessions : devices).refetch();
      return (
        current() &&
        result.data?.ok === true &&
        result.data.attempt > baseline &&
        result.data.attempt === sequence.current[family]
      );
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }
  function remove(family: 'sessions' | 'devices', id: string) {
    if (!scope.isCurrent()) return;
    sequence.current[family]++;
    refreshSequence.current[family]++;
    accepted.current =
      family === 'sessions'
        ? {
            ...accepted.current,
            sessions: accepted.current.sessions.filter((v) => v.sessionId !== id),
          }
        : { ...accepted.current, devices: accepted.current.devices.filter((v) => v.id !== id) };
    setData({ key: scope.key, ...accepted.current });
  }
  return {
    data:
      data.key === scope.key && scope.isCurrent()
        ? data
        : { key: scope.key, sessions: [], devices: [] },
    loading,
    failed,
    read,
    remove,
    current: () => accepted.current,
    ready: (family: 'sessions' | 'devices') =>
      scope.isCurrent() && data.key === scope.key && !loading[family] && !failed[family],
  };
}
export type SecurityLists = ReturnType<typeof useSecuritySettingsLists>;
