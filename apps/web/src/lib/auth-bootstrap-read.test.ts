import { afterEach, expect, it, vi } from 'vitest';
import { readAuthBootstrap } from './auth-bootstrap-read.js';
import { getProfileContextRevision, refreshProfileContext } from './profile-context.js';

afterEach(() => vi.unstubAllGlobals());

it.each(['route', 'profile context'])(
  'rejects late auth data after %s replacement',
  async (cause) => {
    const owner = new AbortController();
    const revision = getProfileContextRevision();
    let release!: (value: unknown) => void;
    const json = new Promise((resolve) => {
      release = resolve;
    });
    const read = vi.fn(async (_url: string, _init: RequestInit) => ({
      status: 200,
      ok: true,
      json: () => json,
    }));
    vi.stubGlobal('fetch', read);
    const result = readAuthBootstrap('/api/auth/user', owner.signal, revision);
    const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    const request = read.mock.calls[0]!;
    expect(request[0]).toBe('/api/auth/user');
    expect(request[1]).toMatchObject({
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (cause === 'route') owner.abort();
    else refreshProfileContext();
    expect(request[1].signal?.aborted).toBe(true);
    release({ userId: 'retired-account', isStaff: true });
    await rejection;
    expect(read).toHaveBeenCalledTimes(1);
  }
);

it('never dispatches a stale auth attempt and reads a current anonymous response once', async () => {
  const revision = getProfileContextRevision();
  refreshProfileContext();
  const json = vi.fn();
  const read = vi.fn(async () => ({ status: 401, ok: false, json }));
  vi.stubGlobal('fetch', read);
  await expect(readAuthBootstrap('/api/auth/user', undefined, revision)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(read).not.toHaveBeenCalled();
  const response = await readAuthBootstrap(
    '/api/auth/user',
    undefined,
    getProfileContextRevision()
  );
  expect(response).toMatchObject({ ok: false, status: 401 });
  expect(json).not.toHaveBeenCalled();
  expect(read).toHaveBeenCalledTimes(1);
});
