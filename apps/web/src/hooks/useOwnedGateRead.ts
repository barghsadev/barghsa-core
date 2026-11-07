import { useCallback } from 'react';
import { queryKeys } from '../lib/query-keys.js';
import { useOwnedManualServerRead } from './useServerQuery.js';

/** Fresh native account-gate GET packets; commands retain their own owners. */
export function useOwnedGateRead(identity: string, actor: string | null, revision: number) {
  const read = useOwnedManualServerRead(identity);
  return useCallback(
    async (path: string, options: RequestInit = {}) => {
      const url = new URL(path, 'http://barghsa.local');
      if (
        !path.startsWith('/api/') ||
        (options.method ?? 'GET') !== 'GET' ||
        options.body !== undefined ||
        !['/api/auth/user', '/api/telegram/link', '/api/tos/current'].includes(url.pathname)
      )
        throw new Error('Invalid account gate read');
      const external = options.signal;
      const authority = {
        context: 'account' as const,
        ownerId: actor ?? 'account-session',
        accountId: actor,
        revision,
      };
      const key =
        url.pathname === '/api/auth/user'
          ? queryKeys.profiles.authority(authority, path)
          : url.pathname === '/api/telegram/link'
            ? queryKeys.preferences.detail(authority, path)
            : queryKeys.catalogue.detail(authority, path);
      const packet = await read(key, external, async (signal, current) => {
        const ownedSignal = external ? AbortSignal.any([external, signal]) : signal;
        const response = await fetch(path, { ...options, signal: ownedSignal });
        const data = response.ok ? ((await response.json()) as unknown) : null;
        if (!current() || signal.aborted) throw new Error('Obsolete account gate read');
        return { ok: response.ok, status: response.status, data };
      });
      return { ok: packet.ok, status: packet.status, json: async () => packet.data };
    },
    [read, actor, revision]
  );
}
