import { useEffect, useRef, useState } from 'react';
import { usePreferenceSettingsOwner } from './usePreferenceSettingsForm.js';
import {
  securitySessions,
  securityTrustedDevices,
  type SecuritySession,
  type TrustedDevice,
} from '../lib/security-settings-form.js';
export type SecurityOwner = ReturnType<typeof usePreferenceSettingsOwner>;
export function useSecuritySettingsLists(scope: SecurityOwner) {
  const accepted = useRef({ sessions: [] as SecuritySession[], devices: [] as TrustedDevice[] });
  const sequence = useRef({ sessions: 0, devices: 0 });
  const [data, setData] = useState({ key: scope.key, ...accepted.current });
  const [loading, setLoading] = useState({ sessions: true, devices: true });
  const [failed, setFailed] = useState({ sessions: false, devices: false });
  async function read(family: 'sessions' | 'devices', signal?: AbortSignal) {
    const attempt = ++sequence.current[family];
    setLoading((v) => ({ ...v, [family]: true }));
    setFailed((v) => ({ ...v, [family]: false }));
    try {
      const response = await fetch(
        '/api/auth/' + (family === 'sessions' ? 'sessions' : 'trusted-devices'),
        {
          credentials: 'include',
          ...(signal ? { signal } : {}),
        }
      );
      if (!scope.isCurrent() || signal?.aborted || attempt !== sequence.current[family])
        return false;
      if ([401, 403].includes(response.status)) {
        scope.deny();
        return false;
      }
      if (!response.ok) throw new Error('Unavailable source');
      const body: unknown = await response.json();
      if (!scope.isCurrent() || signal?.aborted || attempt !== sequence.current[family])
        return false;
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
      return true;
    } catch {
      if (scope.isCurrent() && !signal?.aborted && attempt === sequence.current[family])
        setFailed((v) => ({ ...v, [family]: true }));
      return false;
    } finally {
      if (scope.isCurrent() && !signal?.aborted && attempt === sequence.current[family])
        setLoading((v) => ({ ...v, [family]: false }));
    }
  }
  const active = useRef({ scope, read });
  active.current = { scope, read };
  useEffect(() => {
    sequence.current.sessions++;
    sequence.current.devices++;
    accepted.current = { sessions: [], devices: [] };
    setData({ key: scope.key, ...accepted.current });
    setFailed({ sessions: false, devices: false });
    if (!active.current.scope.isCurrent()) {
      setLoading({ sessions: false, devices: false });
      return;
    }
    const controller = new AbortController();
    void active.current.read('sessions', controller.signal);
    void active.current.read('devices', controller.signal);
    return () => {
      controller.abort();
      sequence.current.sessions++;
      sequence.current.devices++;
    };
  }, [scope.key, scope.denied]);
  function remove(family: 'sessions' | 'devices', id: string) {
    if (!scope.isCurrent()) return;
    sequence.current[family]++;
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
