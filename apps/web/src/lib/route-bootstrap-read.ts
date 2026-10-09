import { getProfileContextRevision, subscribeProfileContext } from './profile-context.js';
import { createServerQueryClient } from './server-query-client.js';
import { queryKeys } from './query-keys.js';
/** A private client owns each bootstrap attempt; no session result is reused across routes. */
export async function readRouteBootstrap(
  path: '/api/auth/user' | '/api/profiles',
  external: AbortSignal | undefined,
  accountId: string | null,
  revision: number
) {
  const client = createServerQueryClient();
  const controller = new AbortController();
  const key = queryKeys.profiles.authority(
    { context: 'account', ownerId: accountId ?? 'route-bootstrap', accountId, revision },
    path
  );
  const cancel = () => {
    controller.abort();
    void client.cancelQueries({ queryKey: key, exact: true });
  };
  const unsubscribe = subscribeProfileContext(cancel);
  external?.addEventListener('abort', cancel, { once: true });
  const current = () =>
    !external?.aborted && !controller.signal.aborted && revision === getProfileContextRevision();
  try {
    if (!current()) {
      cancel();
      throw new Error('Obsolete bootstrap read');
    }
    const packet = await client.fetchQuery({
      queryKey: key,
      staleTime: 0,
      gcTime: 0,
      retry: false,
      queryFn: async ({ signal }) => {
        const response = await fetch(path, {
          credentials: 'include',
          signal,
          headers: { Accept: 'application/json' },
        });
        const data: unknown = response.ok ? await response.json() : null;
        if (!current() || signal.aborted) throw new Error('Obsolete bootstrap read');
        return { ok: response.ok, status: response.status, data };
      },
    });
    if (!current()) throw new Error('Obsolete bootstrap read');
    return { ok: packet.ok, status: packet.status, json: async () => packet.data };
  } catch (error) {
    if (!current())
      throw new DOMException(
        path === '/api/profiles' ? 'Profile check cancelled' : 'Session check cancelled',
        'AbortError'
      );
    throw error;
  } finally {
    unsubscribe();
    external?.removeEventListener('abort', cancel);
    client.clear();
  }
}
