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
    await act(async () => root.render(<Example />));
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
    await act(async () => root.render(<Example />));
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
    await act(async () => root.render(<Example />));
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
  await act(async () => root.render(<Polled />));
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
  await act(async () => root.render(<Warning />));
  await act(async () => vi.advanceTimersByTime(30_000));
  expect(resource).toMatchObject({ status: 'ready', data: 'open-warning', refreshError: true });
  await act(async () => resource.retry());
  expect(resource).toMatchObject({ status: 'ready', data: 'open-warning' });
  await act(async () => finish(response('resolved')));
  expect(resource).toMatchObject({ status: 'ready', data: 'resolved' });
  await act(async () => refreshProfileContext());
  expect(resource).toMatchObject({ status: 'loading', data: null });
});
