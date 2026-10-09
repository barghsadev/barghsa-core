import { afterEach, expect, it, vi } from 'vitest';
import { readSessionContext, readProfileAvailability } from './session-role.js';
import { refreshProfileContext, getProfileContextRevision } from './profile-context.js';
afterEach(() => vi.unstubAllGlobals());
for (const path of ['/api/auth/user', '/api/profiles'] as const) {
  const read = (signal: AbortSignal) =>
    path === '/api/auth/user'
      ? readSessionContext(signal)
      : readProfileAvailability(signal, 'account-one');
  const body =
    path === '/api/auth/user'
      ? { isStaff: false, userId: 'account-one' }
      : { profiles: [{ id: 'business-one' }] };
  it.each(['route', 'profile-context'])(
    'cancels full bootstrap ' + path + ' bytes on %s replacement',
    async (change) => {
      const controller = new AbortController();
      let nativeSignal: AbortSignal | undefined;
      let finish: ((value: unknown) => void) | undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
          expect(url).toBe(path);
          expect(init?.credentials).toBe('include');
          expect(init?.headers).toEqual({ Accept: 'application/json' });
          expect(init?.method).toBeUndefined();
          expect(init?.body).toBeUndefined();
          nativeSignal = init!.signal as AbortSignal;
          return {
            ok: true,
            status: 200,
            json: () =>
              new Promise((resolve) => {
                finish = resolve;
              }),
          } as Response;
        })
      );
      const result = read(controller.signal).then(
        (value) => ({ value }),
        (error) => ({ error })
      );
      await vi.waitFor(() => expect(finish).toBeDefined());
      expect(nativeSignal!.aborted).toBe(false);
      if (change === 'route') controller.abort();
      else refreshProfileContext();
      expect(nativeSignal!.aborted).toBe(true);
      const abandoned = await result;
      expect('error' in abandoned).toBe(true);
      if ('error' in abandoned) expect(abandoned.error.name).toBe('AbortError');
      finish!(body);
      await Promise.resolve();
      expect(fetch).toHaveBeenCalledTimes(1);
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json(body))
      );
      expect(await read(new AbortController().signal)).toEqual(
        path === '/api/profiles'
          ? true
          : expect.objectContaining({
              userId: 'account-one',
              isStaff: false,
              navigationRevision: getProfileContextRevision(),
            })
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  );
  it('does not dispatch already cancelled ' + path + ' bootstrap reads', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const controller = new AbortController();
    controller.abort();
    await expect(read(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
  });
}
it('keeps parallel bootstrap attempts private and cancels only their own route', async () => {
  const first = new AbortController(),
    second = new AbortController();
  const signals: AbortSignal[] = [],
    finish: Array<(value: unknown) => void> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      signals.push(init!.signal as AbortSignal);
      return {
        ok: true,
        status: 200,
        json: () => new Promise((resolve) => finish.push(resolve)),
      } as Response;
    })
  );
  const abandoned = readSessionContext(first.signal).catch((error) => error);
  const current = readSessionContext(second.signal);
  await vi.waitFor(() => expect(finish).toHaveLength(2));
  first.abort();
  expect(signals[0]!.aborted).toBe(true);
  expect(signals[1]!.aborted).toBe(false);
  expect((await abandoned).name).toBe('AbortError');
  finish[0]!({ isStaff: true, userId: 'previous-account' });
  finish[1]!({ isStaff: false, userId: 'current-account' });
  expect(await current).toMatchObject({ isStaff: false, userId: 'current-account' });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('refuses an availability read based on an obsolete verified session revision', async () => {
  const revision = getProfileContextRevision();
  refreshProfileContext();
  vi.stubGlobal('fetch', vi.fn());
  await expect(
    readProfileAvailability(new AbortController().signal, 'old-account', revision)
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetch).not.toHaveBeenCalled();
});
