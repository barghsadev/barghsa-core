import { publicAuthFetch } from './public-auth-fetch.js';
import { readWithDeadline } from './server-query-client.js';

/** The deadline includes the CSRF bootstrap and the complete command acknowledgement. */
export function publicAuthResponse(path: string, init: RequestInit & { signal: AbortSignal }) {
  return readWithDeadline(init.signal, async (signal) => {
    const response = await publicAuthFetch(path, { ...init, signal });
    const body: unknown = await response.json().catch(() => null);
    return { response, body };
  });
}
