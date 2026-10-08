import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryProvider } from '../test/query-provider.js';
import { AccountUserProvider } from './useAccountUser.js';
import { usePreferenceSettingsOwner } from './usePreferenceSettingsForm.js';
import { useSecuritySettingsLists, type SecurityLists } from './useSecuritySettings.js';

let root: Root, host: HTMLDivElement, lists: SecurityLists;
const session = (sessionId: string, isCurrentSession = false) => ({
  sessionId,
  deviceInfo: { ip: '192.0.2.1', userAgent: 'Windows' },
  location: null,
  createdAt: '2026-10-05T00:00:00Z',
  updatedAt: '2026-10-05T00:00:00Z',
  expiresAt: '2030-01-01T00:00:00Z',
  idleDeadline: '2030-01-01T00:00:00Z',
  isCurrentSession,
});
const device = {
  id: 'device',
  userAgent: null,
  ip: null,
  trustedAt: '2026-10-05T00:00:00Z',
  expiresAt: '2030-01-01T00:00:00Z',
  isCurrentDevice: true,
};
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => (resolve = done));
  return { resolve, promise };
}
function Harness() {
  lists = useSecuritySettingsLists(usePreferenceSettingsOwner());
  return <output>{JSON.stringify(lists.data)}</output>;
}
async function mount(actor = 'security-account') {
  await act(async () =>
    root.render(
      <QueryProvider>
        <AccountUserProvider value={actor}>
          <Harness />
        </AccountUserProvider>
      </QueryProvider>
    )
  );
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it('keeps families independent, retries explicitly and never refreshes on focus or reconnect', async () => {
  let sessions = 0,
    devices = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init: RequestInit) => {
      expect(init.credentials).toBe('include');
      expect(init.signal).toBeInstanceOf(AbortSignal);
      if (path.endsWith('trusted-devices')) {
        devices++;
        return Response.json([device]);
      }
      sessions++;
      return sessions === 1
        ? Response.json({}, { status: 503 })
        : Response.json([session('current', true)]);
    })
  );
  await mount();
  expect(lists.failed).toEqual({ sessions: true, devices: false });
  expect(lists.ready('devices')).toBe(true);
  expect(lists.data.devices).toEqual([device]);
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect([sessions, devices]).toEqual([1, 1]);
  await act(async () => expect(await lists.read('sessions')).toBe(true));
  expect(lists.ready('sessions')).toBe(true);
  expect([sessions, devices]).toEqual([2, 1]);
});
it('replaces a pending initial read with a fresh validated read and ignores its late denial', async () => {
  const held = deferred();
  let reads = 0,
    initialSignal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init: RequestInit) => {
      if (path.endsWith('trusted-devices')) return Response.json([device]);
      if (++reads === 1) {
        initialSignal = init.signal as AbortSignal;
        return held.promise;
      }
      return Response.json([session('fresh', true)]);
    })
  );
  await mount();
  await act(async () => expect(await lists.read('sessions')).toBe(true));
  expect(initialSignal?.aborted).toBe(true);
  await act(async () => held.resolve(Response.json({}, { status: 403 })));
  expect(lists.data.sessions).toEqual([session('fresh', true)]);
  expect(lists.data.devices).toEqual([device]);
  expect(reads).toBe(2);
});
it('confirmed removal fences a pending read, including its success result', async () => {
  const held = deferred();
  let reads = 0,
    pending!: Promise<boolean>;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      if (path.endsWith('trusted-devices')) return Response.json([device]);
      return ++reads === 1
        ? Response.json([session('current', true), session('removed')])
        : held.promise;
    })
  );
  await mount();
  await act(async () => {
    pending = lists.read('sessions');
  });
  await act(async () => lists.remove('sessions', 'removed'));
  await act(async () =>
    held.resolve(Response.json([session('current', true), session('removed')]))
  );
  expect(await pending).toBe(false);
  expect(lists.current().sessions).toEqual([session('current', true)]);
  expect(lists.data.sessions).toEqual([session('current', true)]);
});
it('does not use cached success when an explicit read is aborted', async () => {
  const held = deferred();
  let reads = 0,
    pending!: Promise<boolean>,
    signal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init: RequestInit) => {
      if (path.endsWith('trusted-devices')) return Response.json([device]);
      if (++reads === 1) return Response.json([session('current', true)]);
      signal = init.signal as AbortSignal;
      return held.promise;
    })
  );
  await mount();
  const controller = new AbortController();
  await act(async () => {
    pending = lists.read('sessions', controller.signal);
  });
  await act(async () => controller.abort());
  expect(await pending).toBe(false);
  expect(signal?.aborted).toBe(true);
  await act(async () => held.resolve(Response.json([session('obsolete', true)])));
  expect(lists.data.sessions).toEqual([session('current', true)]);
});
it('cancels retired account reads and ignores their late authorization denial', async () => {
  const held = deferred();
  let reads = 0,
    oldSignal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init: RequestInit) => {
      if (path.endsWith('trusted-devices')) return Response.json([device]);
      if (++reads === 1) {
        oldSignal = init.signal as AbortSignal;
        return held.promise;
      }
      return Response.json([session('new-current', true)]);
    })
  );
  await mount();
  await mount('new-account');
  expect(oldSignal?.aborted).toBe(true);
  await act(async () => held.resolve(Response.json({}, { status: 401 })));
  expect(lists.data.sessions).toEqual([session('new-current', true)]);
  expect(lists.ready('sessions')).toBe(true);
  expect(reads).toBe(2);
});
it('aborts both family reads on unmount', async () => {
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
  await act(async () => root.unmount());
  root = createRoot(host);
  expect(signals).toHaveLength(2);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  await act(async () => held.resolve(Response.json({}, { status: 403 })));
});
it('an older refresh abort cannot cancel its replacement and only the replacement confirms', async () => {
  const first = deferred(),
    second = deferred();
  let reads = 0,
    old!: Promise<boolean>,
    replacement!: Promise<boolean>,
    latestSignal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init: RequestInit) => {
      if (path.endsWith('trusted-devices')) return Response.json([device]);
      reads++;
      if (reads === 1) return Response.json([session('initial', true)]);
      if (reads === 2) return first.promise;
      latestSignal = init.signal as AbortSignal;
      return second.promise;
    })
  );
  await mount();
  const controller = new AbortController();
  await act(async () => {
    old = lists.read('sessions', controller.signal);
  });
  await act(async () => {
    replacement = lists.read('sessions');
  });
  await act(async () => controller.abort());
  expect(latestSignal?.aborted).toBe(false);
  await act(async () => second.resolve(Response.json([session('replacement', true)])));
  expect(await replacement).toBe(true);
  expect(await old).toBe(false);
  await act(async () => first.resolve(Response.json({}, { status: 403 })));
  expect(lists.data.sessions).toEqual([session('replacement', true)]);
});
it('confirmed device removal also supersedes a late authorization denial', async () => {
  const held = deferred();
  let reads = 0,
    pending!: Promise<boolean>;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      if (!path.endsWith('trusted-devices')) return Response.json([session('current', true)]);
      return ++reads === 1 ? Response.json([device]) : held.promise;
    })
  );
  await mount();
  await act(async () => {
    pending = lists.read('devices');
  });
  await act(async () => lists.remove('devices', 'device'));
  await act(async () => held.resolve(Response.json({}, { status: 401 })));
  expect(await pending).toBe(false);
  expect(lists.data.devices).toEqual([]);
  expect(lists.data.sessions).toEqual([session('current', true)]);
});
