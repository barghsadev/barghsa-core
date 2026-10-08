import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { AccountUserProvider } from './useAccountUser.js';
import { useCustomerServiceHistory } from './useCustomerServiceHistory.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { QueryProvider } from '../providers/QueryProvider.js';
const first = '89000000-0000-4000-8000-000000000001',
  second = '89000000-0000-4000-8000-000000000003';
const profileA = '89000000-0000-4000-8000-000000000002',
  profileB = '89000000-0000-4000-8000-000000000004';
const identify = (item: { id: string }) => item.id;
const reply = (id = first, nextBefore: string | null = first) =>
  Response.json({ orders: [{ id }], nextBefore });
let root: Root | undefined, host: HTMLDivElement;
let history!: ReturnType<typeof useCustomerServiceHistory<{ id: string }>>;
function Harness({ query = 'q=saved&statuses=submitted' }: { query?: string }) {
  history = useCustomerServiceHistory({
    resource: 'orders',
    endpoint: '/api/orders',
    query,
    itemsKey: 'orders',
    identify,
  });
  return (
    <span>
      {history.items.map((row) => row.id).join(',')}|{history.error}
    </span>
  );
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  vi.unstubAllGlobals();
});
async function start(fetchMock: ReturnType<typeof vi.fn>, account: string | null = 'account-a') {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', fetchMock);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <QueryProvider>
        <AccountUserProvider value={account}>
          <Harness />
        </AccountUserProvider>
      </QueryProvider>
    )
  );
}
async function settled(check: () => void) {
  await vi.waitFor(async () => {
    await act(async () => {});
    check();
  });
}
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

it.each(['account', 'profile'] as const)(
  'hides old pages immediately after a %s switch and ignores stale success or denial',
  async (mode) => {
    const held = deferred();
    const urls: URL[] = [];
    let switched = false;
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input, 'http://localhost');
      urls.push(url);
      if (url.pathname === '/api/profiles')
        return Response.json({ activeProfileId: switched ? profileB : profileA });
      if (!switched && url.searchParams.has('before')) return held.promise;
      return switched ? reply(second, null) : reply();
    });
    await start(fetchMock);
    await settled(() => expect(host.textContent).toContain(first));
    const staleLoad = history.loadMore,
      staleRetry = history.retry;
    await act(async () => history.loadMore());
    await settled(() => expect(history.loading).toBe(true));
    switched = true;
    await act(async () => {
      if (mode === 'account')
        root!.render(
          <QueryProvider>
            <AccountUserProvider value="account-b">
              <Harness />
            </AccountUserProvider>
          </QueryProvider>
        );
      else refreshProfileContext();
    });
    expect(host.textContent).not.toContain(first);
    await settled(() => expect(host.textContent).toContain(second));
    const requestCount = urls.length;
    await act(async () => {
      staleLoad();
      staleRetry();
    });
    expect(urls).toHaveLength(requestCount);
    await act(async () =>
      held.resolve(mode === 'account' ? reply(first, null) : Response.json({}, { status: 403 }))
    );
    expect(host.textContent).toContain(second);
    expect(host.textContent).not.toContain(first);
    expect(history.error).toBeNull();
    const current = urls.filter(
      (url) => url.pathname === '/api/orders' && url.searchParams.get('profileId') === profileB
    );
    expect(current).toHaveLength(1);
    expect(current[0]!.searchParams.has('before')).toBe(false);
  }
);

it('detects an unannounced profile change before requesting history with the old cursor', async () => {
  let switched = false,
    failMore = true;
  const held = deferred();
  const urls: URL[] = [];
  await start(
    vi.fn(async (input: string) => {
      const url = new URL(input, 'http://localhost');
      urls.push(url);
      if (url.pathname === '/api/profiles')
        return Response.json({ activeProfileId: switched ? profileB : profileA });
      if (switched) return held.promise;
      return url.searchParams.has('before') && failMore
        ? Response.json({}, { status: 503 })
        : reply();
    })
  );
  await settled(() => expect(host.textContent).toContain(first));
  await act(async () => history.loadMore());
  await settled(() => expect(history.error).toBe('load'));
  expect(host.textContent).toContain(first);
  switched = true;
  failMore = false;
  await act(async () => history.retry());
  await settled(() =>
    expect(
      urls.some(
        (url) => url.pathname === '/api/orders' && url.searchParams.get('profileId') === profileB
      )
    ).toBe(true)
  );
  expect(host.textContent).not.toContain(first);
  const current = urls.filter(
    (url) => url.pathname === '/api/orders' && url.searchParams.get('profileId') === profileB
  );
  expect(current).toHaveLength(1);
  expect(current[0]!.searchParams.has('before')).toBe(false);
  expect(current[0]!.searchParams.get('q')).toBe('saved');
  await act(async () => held.resolve(reply(second, null)));
  await settled(() => expect(host.textContent).toContain(second));
});

it('clears a missing profile after pagination and preserves query criteria when a profile returns', async () => {
  let active: string | null = profileA;
  const urls: URL[] = [];
  await start(
    vi.fn(async (input: string) => {
      const url = new URL(input, 'http://localhost');
      urls.push(url);
      return url.pathname === '/api/profiles'
        ? Response.json({ activeProfileId: active })
        : reply(active === profileA ? first : second);
    })
  );
  await settled(() => expect(host.textContent).toContain(first));
  active = null;
  await act(async () => history.loadMore());
  await settled(() => expect(history.noProfile).toBe(true));
  expect(history.items).toEqual([]);
  expect(history.nextBefore).toBeNull();
  expect(history.error).toBeNull();
  active = profileB;
  await act(async () => history.retry());
  await settled(() => expect(host.textContent).toContain(second));
  expect(urls.at(-1)!.searchParams.get('profileId')).toBe(profileB);
  expect(urls.at(-1)!.searchParams.has('before')).toBe(false);
});

it.each(['transient', 'malformed', 'whitespace'] as const)(
  'retains accepted history and the exact cursor on a %s profile read',
  async (mode) => {
    let fail = false;
    const urls: URL[] = [];
    await start(
      vi.fn(async (input: string) => {
        const url = new URL(input, 'http://localhost');
        urls.push(url);
        if (url.pathname === '/api/profiles')
          return fail
            ? mode === 'transient'
              ? Response.json({}, { status: 503 })
              : Response.json({ activeProfileId: mode === 'whitespace' ? '   ' : [profileA] })
            : Response.json({ activeProfileId: profileA });
        return url.searchParams.has('before') ? reply(second, null) : reply();
      })
    );
    await settled(() => expect(host.textContent).toContain(first));
    fail = true;
    await act(async () => history.loadMore());
    await settled(() => expect(history.error).toBe('load'));
    expect(host.textContent).toContain(first);
    fail = false;
    await act(async () => history.retry());
    await settled(() => expect(host.textContent).toContain(second));
    expect(host.textContent).toContain(first);
    expect(urls.at(-1)!.searchParams.get('before')).toBe(first);
  }
);

it.each([401, 403])(
  'clears accepted rows on history denial %s and restarts with a fresh first page',
  async (status) => {
    let failMore = true;
    const urls: URL[] = [];
    await start(
      vi.fn(async (input: string) => {
        const url = new URL(input, 'http://localhost');
        urls.push(url);
        if (url.pathname === '/api/profiles') return Response.json({ activeProfileId: profileA });
        return url.searchParams.has('before') && failMore ? Response.json({}, { status }) : reply();
      })
    );
    await settled(() => expect(host.textContent).toContain(first));
    await act(async () => history.loadMore());
    await settled(() => expect(history.error).toBe('denied'));
    expect(history.items).toEqual([]);
    expect(history.nextBefore).toBeNull();
    failMore = false;
    await act(async () => history.retry());
    await settled(() => expect(host.textContent).toContain(first));
    expect(history.error).toBeNull();
    expect(urls.at(-1)!.searchParams.has('before')).toBe(false);
    expect(urls.filter((url) => url.pathname === '/api/orders')).toHaveLength(3);
  }
);

it('deduplicates two readers and keeps a shared pending read alive when one changes filters', async () => {
  const held = deferred(),
    more = deferred();
  const requests: { url: URL; signal: AbortSignal }[] = [];
  const readers = new Map<string, ReturnType<typeof useCustomerServiceHistory<{ id: string }>>>();
  function Reader({ name, query }: { name: string; query: string }) {
    const value = useCustomerServiceHistory({
      resource: 'orders',
      endpoint: '/api/orders',
      query,
      itemsKey: 'orders',
      identify,
    });
    readers.set(name, value);
    return (
      <span id={name}>
        {value.items.map((row) => row.id).join(',')}|{value.error}
      </span>
    );
  }
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, options: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      if (url.pathname === '/api/profiles') return Response.json({ activeProfileId: profileA });
      requests.push({ url, signal: options.signal as AbortSignal });
      return url.searchParams.has('before')
        ? more.promise
        : url.searchParams.get('q') === 'saved'
          ? held.promise
          : reply(second, null);
    })
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const render = (firstQuery: string, secondReader = true) =>
    act(async () =>
      root!.render(
        <QueryProvider>
          <AccountUserProvider value="account-a">
            <div>
              <Reader name="reader-a" query={firstQuery} />
              {secondReader && <Reader name="reader-b" query="q=saved" />}
            </div>
          </AccountUserProvider>
        </QueryProvider>
      )
    );
  await render('q=saved');
  await settled(() => expect(requests).toHaveLength(1));
  await render('q=other');
  await settled(() => expect(host.querySelector('#reader-a')?.textContent).toContain(second));
  expect(requests[0]!.signal.aborted).toBe(false);
  await act(async () => held.resolve(reply()));
  await settled(() => expect(host.querySelector('#reader-b')?.textContent).toContain(first));
  expect(host.querySelector('#reader-a')?.textContent).not.toContain(first);
  expect(requests.filter((request) => request.url.searchParams.get('q') === 'saved')).toHaveLength(
    1
  );
  await act(async () => readers.get('reader-b')!.loadMore());
  await settled(() =>
    expect(requests.some((request) => request.url.searchParams.has('before'))).toBe(true)
  );
  const pending = requests.find((request) => request.url.searchParams.has('before'))!;
  await render('q=other', false);
  expect(pending.signal.aborted).toBe(true);
  await act(async () => more.resolve(reply(second, null)));
  expect(host.querySelector('#reader-a')?.textContent).toContain(second);
});

it('waits for an account identity before querying profile authority or private history', async () => {
  const fetchMock = vi.fn(async (input: string) =>
    input === '/api/profiles' ? Response.json({ activeProfileId: profileA }) : reply()
  );
  await start(fetchMock, null);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(history.loading).toBe(true);
  expect(history.items).toEqual([]);
  await act(async () =>
    root!.render(
      <QueryProvider>
        <AccountUserProvider value="account-a">
          <Harness />
        </AccountUserProvider>
      </QueryProvider>
    )
  );
  await settled(() => expect(host.textContent).toContain(first));
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('confirms profile authority freshly before each page and explicit retry', async () => {
  let profileReads = 0,
    failMore = true;
  await start(
    vi.fn(async (input: string) => {
      const url = new URL(input, 'http://localhost');
      if (url.pathname === '/api/profiles') {
        profileReads++;
        return Response.json({ activeProfileId: profileA });
      }
      if (url.searchParams.has('before'))
        return failMore ? Response.json({}, { status: 503 }) : reply(second, null);
      return reply();
    })
  );
  await settled(() => expect(host.textContent).toContain(first));
  expect(profileReads).toBe(1);
  await act(async () => history.loadMore());
  await settled(() => expect(history.error).toBe('load'));
  expect(profileReads).toBe(2);
  failMore = false;
  await act(async () => history.retry());
  await settled(() => expect(host.textContent).toContain(second));
  expect(profileReads).toBe(3);
  expect(host.textContent).toContain(first);
});
