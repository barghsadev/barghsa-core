import { getProfileContextRevision, subscribeProfileContext } from './profile-context.js';

/** The public auth entry checks live authority before the signed-in query client is available. */
export async function readAuthBootstrap(
  path: '/api/auth/user' | '/api/profiles',
  external: AbortSignal | undefined,
  revision: number
) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const unsubscribe = subscribeProfileContext(cancel);
  external?.addEventListener('abort', cancel, { once: true });
  const check = () => {
    if (external?.aborted || controller.signal.aborted || revision !== getProfileContextRevision())
      throw new DOMException(
        path === '/api/profiles' ? 'Profile check cancelled' : 'Session check cancelled',
        'AbortError'
      );
  };
  try {
    check();
    const response = await fetch(path, {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    const data: unknown = response.ok ? await response.json() : null;
    check();
    return { ok: response.ok, status: response.status, json: async () => data };
  } catch (error) {
    check();
    throw error;
  } finally {
    unsubscribe();
    external?.removeEventListener('abort', cancel);
  }
}
