import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryProvider } from '../test/query-provider.js';
import { useOwnedProfileRead } from './useOwnedProfileRead.js';

const profileId = '11111111-1111-4111-8111-111111111111';
let root: Root, host: HTMLDivElement, client: QueryClient;
let read: ReturnType<typeof useOwnedProfileRead>;
let active: string, withdrawn: boolean;
const denied = vi.fn(() => {
  withdrawn = true;
});
function Harness({ actor, revision }: { actor: string; revision: number }) {
  const identity = JSON.stringify([actor, revision]);
  active = identity;
  client = useQueryClient();
  read = useOwnedProfileRead(
    identity,
    { context: 'account', ownerId: actor, accountId: actor, revision },
    (token) => token === active && !withdrawn,
    denied
  );
  return null;
}
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function mount(actor = 'account', revision = 2) {
  await act(async () =>
    root.render(
      <QueryProvider>
        <Harness actor={actor} revision={revision} />
      </QueryProvider>
    )
  );
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  withdrawn = false;
  denied.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it('uses authority/detail/list factories with actual account/profile owners and fresh request keys', async () => {
  const keys: Array<readonly unknown[]> = [],
    paths: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init: RequestInit) => {
      expect(init.credentials).toBe('include');
      expect(init.signal).toBeInstanceOf(AbortSignal);
      keys.push([
        ...client
          .getQueryCache()
          .getAll()
          .find((query) => query.state.fetchStatus === 'fetching')!.queryKey,
      ]);
      paths.push(path);
      return Response.json({ path });
    })
  );
  await mount();
  for (const path of [
    '/api/profiles',
    '/api/profiles/' + profileId,
    '/api/profiles/' + profileId + '/addresses',
  ])
    expect(await read(path, active)).toEqual({ path });
  expect(keys.map((key) => key.slice(0, 7))).toEqual([
    ['barghsa', 'profiles', 'account', 'account', 2, 'account', 'authority'],
    ['barghsa', 'profiles', 'customer', profileId, 2, 'account', 'detail'],
    ['barghsa', 'profiles', 'customer', profileId, 2, 'account', 'list'],
  ]);
  await read('/api/profiles', active);
  expect(JSON.stringify(keys[3])).not.toBe(JSON.stringify(keys[0]));
  expect(paths).toEqual([
    '/api/profiles',
    '/api/profiles/' + profileId,
    '/api/profiles/' + profileId + '/addresses',
    '/api/profiles',
  ]);
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(paths).toHaveLength(4);
});
it('a replacement cancels pending transport and refuses its late denial', async () => {
  const held = deferred();
  let count = 0,
    signal: AbortSignal | null | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_path: string, init: RequestInit) => {
      if (++count === 1) {
        signal = init.signal;
        return held.promise;
      }
      return Response.json({ fresh: true });
    })
  );
  await mount();
  const old = read('/api/profiles', active).catch((error: unknown) => error);
  expect(await read('/api/profiles', active)).toEqual({ fresh: true });
  expect(signal?.aborted).toBe(true);
  expect(await old).toBeInstanceOf(Error);
  held.resolve(Response.json({}, { status: 403 }));
  await act(async () => {});
  expect(denied).not.toHaveBeenCalled();
  expect(count).toBe(2);
});
it('scope replacement cancels all owned paths and ignores old private replies', async () => {
  const held = deferred(),
    signals: AbortSignal[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_path: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal);
      return held.promise;
    })
  );
  await mount();
  const pending = ['/api/profiles', '/api/profiles/' + profileId + '/addresses'].map((path) =>
    read(path, active).catch((error: unknown) => error)
  );
  await mount('replacement', 3);
  expect(signals).toHaveLength(2);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect((await Promise.all(pending)).every((result) => result instanceof Error)).toBe(true);
  held.resolve(Response.json({}, { status: 401 }));
  await act(async () => {});
  expect(denied).not.toHaveBeenCalled();
});
it('unmount aborts each outstanding authority/detail/list read', async () => {
  const held = deferred(),
    signals: AbortSignal[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_path: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal);
      return held.promise;
    })
  );
  await mount();
  const pending = [
    '/api/profiles',
    '/api/profiles/' + profileId,
    '/api/profiles/' + profileId + '/addresses',
  ].map((path) => read(path, active).catch((error: unknown) => error));
  await act(async () => root.unmount());
  root = createRoot(host);
  expect(signals).toHaveLength(3);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect((await Promise.all(pending)).every((result) => result instanceof Error)).toBe(true);
  held.resolve(Response.json({}, { status: 404 }));
  await act(async () => {});
  expect(denied).not.toHaveBeenCalled();
});
it('never uses previous success to confirm a failed read and never retries a transient failure', async () => {
  let count = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      ++count === 1 ? Response.json({ accepted: true }) : Response.json({}, { status: 503 })
    )
  );
  await mount();
  expect(await read('/api/profiles', active)).toEqual({ accepted: true });
  await expect(read('/api/profiles', active)).rejects.toThrow('Profile read failed');
  expect(count).toBe(2);
  expect(denied).not.toHaveBeenCalled();
});
it('current missing access withdraws the owner while obsolete or unsupported requests make no fetch', async () => {
  const fetcher = vi.fn(async () => Response.json({}, { status: 404 }));
  vi.stubGlobal('fetch', fetcher);
  await mount();
  await expect(read('/api/unrelated', active)).rejects.toThrow('Invalid profile read path');
  await expect(read('/api/profiles', 'retired-owner')).rejects.toThrow('Obsolete profile read');
  expect(fetcher).not.toHaveBeenCalled();
  await expect(read('/api/profiles/' + profileId, active)).rejects.toThrow('Profile unavailable');
  expect(denied).toHaveBeenCalledTimes(1);
  await expect(read('/api/profiles', active)).rejects.toThrow('Obsolete profile read');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
