import { act, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { QueryProvider } from '../test/query-provider.js';
import { AccountUserProvider } from './useAccountUser.js';
import { useOperationalQueue } from './useOperationalQueue.js';
const validate = (value: unknown): value is { id: string } =>
  !!value && typeof value === 'object' && 'id' in value && typeof value.id === 'string';
const response = (value: unknown) => Response.json(value);
it('returning to a page performs a fresh GET and cancels the discarded page', async () => {
  const host = document.createElement('div'),
    root = createRoot(host);
  let queue!: ReturnType<typeof useOperationalQueue<{ id: string }>>;
  let held!: { signal: AbortSignal; resolve: (response: Response) => void };
  let firstReads = 0;
  const reads = vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/access')) return response({ canView: true, canRetry: true });
    if (new URL(path, 'http://localhost').searchParams.get('offset') === '25')
      return new Promise<Response>((resolve) => {
        held = { signal: init.signal!, resolve };
      });
    return response([{ id: `first-${++firstReads}` }]);
  });
  vi.stubGlobal('fetch', reads);
  function Harness({ offset }: { offset: number }) {
    queue = useOperationalQueue(
      '/queue',
      '',
      offset,
      validate,
      useCallback(() => {}, [])
    );
    return <button disabled={!queue.ready}>{queue.data?.rows[0]?.id ?? 'unavailable'}</button>;
  }
  try {
    await act(async () =>
      root.render(
        <QueryProvider>
          <Harness offset={0} />
        </QueryProvider>
      )
    );
    expect(host.textContent).toBe('first-1');
    await act(async () =>
      root.render(
        <QueryProvider>
          <Harness offset={25} />
        </QueryProvider>
      )
    );
    expect(host.textContent).toBe('first-1');
    expect(host.querySelector('button')!.disabled).toBe(true);
    await act(async () =>
      root.render(
        <QueryProvider>
          <Harness offset={0} />
        </QueryProvider>
      )
    );
    expect(firstReads).toBe(2);
    expect(held.signal.aborted).toBe(true);
    await act(async () => held.resolve(response([{ id: 'discarded' }])));
    expect(host.textContent).toBe('first-2');
    expect(queue.data?.offset).toBe(0);
    expect(queue.ready).toBe(true);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
it('withdraws old-account rows and ignores its late denial until new authority is confirmed', async () => {
  const host = document.createElement('div'),
    root = createRoot(host);
  let queue!: ReturnType<typeof useOperationalQueue<{ id: string }>>;
  let account = 'a',
    hold = false;
  let old!: { signal: AbortSignal; resolve: (response: Response) => void };
  let authorize!: (response: Response) => void;
  const denied = vi.fn();
  const reads = vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/access'))
      return account === 'b'
        ? new Promise<Response>((r) => {
            authorize = r;
          })
        : response({ canView: true, canRetry: true });
    if (hold && account === 'a')
      return new Promise<Response>((resolve) => {
        old = { signal: init.signal!, resolve };
      });
    return response([{ id: account }]);
  });
  vi.stubGlobal('fetch', reads);
  function Harness() {
    queue = useOperationalQueue('/queue', '', 0, validate, denied);
    return <p>{queue.data?.rows[0]?.id ?? 'unavailable'}</p>;
  }
  const render = () =>
    root.render(
      <QueryProvider>
        <AccountUserProvider value={account}>
          <Harness />
        </AccountUserProvider>
      </QueryProvider>
    );
  try {
    await act(async () => render());
    expect(host.textContent).toBe('a');
    hold = true;
    await act(async () => queue.retry());
    account = 'b';
    await act(async () => render());
    expect(host.textContent).toBe('unavailable');
    expect(queue.ready).toBe(false);
    expect(old.signal.aborted).toBe(true);
    await act(async () => old.resolve(new Response('', { status: 403 })));
    expect(denied).not.toHaveBeenCalled();
    expect(host.textContent).toBe('unavailable');
    await act(async () => authorize(response({ canView: true, canRetry: true })));
    expect(host.textContent).toBe('b');
    expect(queue.ready).toBe(true);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
