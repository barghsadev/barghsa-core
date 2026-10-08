import { AccountUserProvider } from './useAccountUser.js';
import { QueryProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAsyncData, type AsyncData } from './useAsyncData.js';
import { refreshProfileContext } from '../lib/profile-context.js';

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
let root: Root;
let container: HTMLDivElement;
let resource: AsyncData<string>;
let other: AsyncData<string>;
function Example() {
  resource = useAsyncData<string>('/resource');
  other = useAsyncData<string>('/other');
  return null;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useAsyncData', () => {
  it('keeps successful resources while retrying only a failed resource', async () => {
    let reads = 0;
    const fetcher = vi.fn(async (url: string) =>
      url === '/resource' ? response('invoice', ++reads === 1 ? 503 : 200) : response('order')
    );
    vi.stubGlobal('fetch', fetcher);
    await act(async () =>
      root.render(
        <QueryProvider>
          <Example />
        </QueryProvider>
      )
    );
    expect(resource.status).toBe('error');
    expect(other).toMatchObject({ status: 'ready', data: 'order' });
    await act(async () => resource.retry());
    expect(resource).toMatchObject({ status: 'ready', data: 'invoice' });
    expect(fetcher.mock.calls.filter(([url]) => url === '/other')).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([url]) => url === '/resource')).toHaveLength(2);
  });

  it('clears loaded profile data immediately and ignores an aborted late response', async () => {
    let resolveOld: (value: Response) => void = () => {};
    let resolveNew: (value: Response) => void = () => {};
    let reads = 0;
    const fetcher = vi.fn((url: string, _options: RequestInit) => {
      if (url === '/other') return Promise.resolve(response('other'));
      if (++reads === 1) return Promise.resolve(response('first-profile'));
      return new Promise<Response>((resolve) => {
        if (reads === 2) resolveOld = resolve;
        else resolveNew = resolve;
      });
    });
    vi.stubGlobal('fetch', fetcher);
    await act(async () =>
      root.render(
        <QueryProvider>
          <Example />
        </QueryProvider>
      )
    );
    expect(resource).toMatchObject({ status: 'ready', data: 'first-profile' });
    await act(async () => resource.retry());
    expect(resource).toMatchObject({ status: 'loading', data: null });
    await act(async () => refreshProfileContext());
    expect(resource).toMatchObject({ status: 'loading', data: null });
    const oldRequest = fetcher.mock.calls.filter(([url]) => url === '/resource')[1]!;
    expect(oldRequest[1].signal?.aborted).toBe(true);
    await act(async () => resolveOld(response('late-first-profile')));
    expect(resource).toMatchObject({ status: 'loading', data: null });
    await act(async () => resolveNew(response('new-profile')));
    expect(resource).toMatchObject({ status: 'ready', data: 'new-profile' });
  });

  it('aborts on unmount and treats malformed JSON as a retryable resource failure', async () => {
    const fetcher = vi.fn((_url: string, _options: RequestInit) =>
      Promise.resolve(new Response('invalid JSON', { status: 200 }))
    );
    vi.stubGlobal('fetch', fetcher);
    await act(async () =>
      root.render(
        <QueryProvider>
          <Example />
        </QueryProvider>
      )
    );
    expect(resource.status).toBe('error');
    await act(async () => root.render(null));
    expect(fetcher.mock.calls[0]![1].signal?.aborted).toBe(true);
  });
});

it('polls without overlapping held reads and cancels the timer on unmount', async () => {
  vi.useFakeTimers();
  let finish!: (response: Response) => void;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      })
  );
  vi.stubGlobal('fetch', fetcher);
  function Polled() {
    resource = useAsyncData<string>('/resource', { refreshIntervalMs: 30_000 });
    return null;
  }
  await act(async () =>
    root.render(
      <QueryProvider>
        <Polled />
      </QueryProvider>
    )
  );
  await act(async () => vi.advanceTimersByTime(90_000));
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => finish(response('first')));
  await act(async () => vi.advanceTimersByTime(30_000));
  expect(resource).toMatchObject({ status: 'ready', data: 'first' });
  expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () => finish(response('next')));
  expect(resource).toMatchObject({ status: 'ready', data: 'next' });
  await act(async () => root.render(null));
  await act(async () => vi.advanceTimersByTime(90_000));
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('retains a known warning through failed refresh and retry, but clears it on context change', async () => {
  vi.useFakeTimers();
  let finish!: (response: Response) => void;
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response('open-warning'))
    .mockResolvedValueOnce(response({}, 503))
    .mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        })
    );
  vi.stubGlobal('fetch', fetcher);
  function Warning() {
    resource = useAsyncData<string>('/warning', {
      refreshIntervalMs: 30_000,
      retainDataOnRefreshError: true,
    });
    return null;
  }
  await act(async () =>
    root.render(
      <QueryProvider>
        <Warning />
      </QueryProvider>
    )
  );
  await act(async () => vi.advanceTimersByTime(30_000));
  expect(resource).toMatchObject({ status: 'ready', data: 'open-warning', refreshError: true });
  await act(async () => resource.retry());
  expect(resource).toMatchObject({ status: 'ready', data: 'open-warning' });
  await act(async () => finish(response('resolved')));
  expect(resource).toMatchObject({ status: 'ready', data: 'resolved' });
  await act(async () => refreshProfileContext());
  expect(resource).toMatchObject({ status: 'loading', data: null });
});

it('does not poll financial URLs even when an interval is requested', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => response({ balance: 123456789 }));
  vi.stubGlobal('fetch', fetcher);
  function Financial() {
    useAsyncData('/api/wallet/balance', { refreshIntervalMs: 30_000 });
    return null;
  }
  await act(async () =>
    root.render(
      <QueryProvider>
        <Financial />
      </QueryProvider>
    )
  );
  await act(async () => vi.advanceTimersByTime(90_000));
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('withdraws a retained warning on account replacement and discards the former account response', async () => {
  let account = 'a',
    hold = false;
  const pending: { signal: AbortSignal; resolve: (response: Response) => void }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, options: RequestInit) =>
      !hold
        ? Promise.resolve(response('private-a'))
        : new Promise<Response>((resolve) => {
            pending.push({ signal: options.signal!, resolve });
          })
    )
  );
  function Owned() {
    resource = useAsyncData<string>('/warning', { retainDataOnRefreshError: true });
    return null;
  }
  const render = () =>
    root.render(
      <QueryProvider>
        <AccountUserProvider value={account}>
          <Owned />
        </AccountUserProvider>
      </QueryProvider>
    );
  await act(async () => render());
  expect(resource).toMatchObject({ status: 'ready', data: 'private-a' });
  hold = true;
  await act(async () => resource.retry());
  account = 'b';
  await act(async () => render());
  expect(resource).toMatchObject({ status: 'loading', data: null });
  expect(pending[0]!.signal.aborted).toBe(true);
  await act(async () => pending[0]!.resolve(response('late-a')));
  expect(resource).toMatchObject({ status: 'loading', data: null });
  await act(async () => pending[1]!.resolve(response('private-b')));
  expect(resource).toMatchObject({ status: 'ready', data: 'private-b' });
});

it('uses a changed parser for a fresh read and preserves its undefined success value', async () => {
  const fetcher = vi.fn(async () => response({ value: 'wire' }));
  vi.stubGlobal('fetch', fetcher);
  let parse = async (_response: Response): Promise<string | undefined> => 'parsed';
  let parsed!: AsyncData<string | undefined>;
  function Parsed() {
    parsed = useAsyncData('/parse', { read: parse });
    return null;
  }
  await act(async () =>
    root.render(
      <QueryProvider>
        <Parsed />
      </QueryProvider>
    )
  );
  expect(parsed).toMatchObject({ status: 'ready', data: 'parsed' });
  parse = async () => undefined;
  await act(async () =>
    root.render(
      <QueryProvider>
        <Parsed />
      </QueryProvider>
    )
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(parsed).toMatchObject({ status: 'ready', data: undefined });
});

it('deduplicates initial readers and keeps transport alive until the last observer leaves', async () => {
  let signal!: AbortSignal;
  const fetcher = vi.fn((_url: string, options: RequestInit) => {
    signal = options.signal!;
    return new Promise<Response>(() => {});
  });
  vi.stubGlobal('fetch', fetcher);
  function Reader() {
    useAsyncData('/shared');
    return null;
  }
  function Shared({ both }: { both: boolean }) {
    return (
      <QueryProvider>
        <AccountUserProvider value="a">
          <Reader />
          {both && <Reader />}
        </AccountUserProvider>
      </QueryProvider>
    );
  }
  await act(async () => root.render(<Shared both />));
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<Shared both={false} />));
  expect(signal.aborted).toBe(false);
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
});

it('deduplicates an initial value but never reuses another observer’s explicit retry receipt', async () => {
  let count = 0;
  const fetcher = vi.fn(async () => response(++count));
  vi.stubGlobal('fetch', fetcher);
  const readers: AsyncData<number>[] = [];
  function Reader({ index }: { index: number }) {
    readers[index] = useAsyncData<number>('/shared');
    return null;
  }
  await act(async () =>
    root.render(
      <QueryProvider>
        <AccountUserProvider value="a">
          <Reader index={0} />
          <Reader index={1} />
        </AccountUserProvider>
      </QueryProvider>
    )
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => readers[0]!.retry());
  await act(async () => readers[1]!.retry());
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(readers.map((r) => r.data)).toEqual([2, 3]);
});
