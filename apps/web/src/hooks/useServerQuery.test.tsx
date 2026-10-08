import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { queryKeys, sameServerList } from '../lib/query-keys.js';
import { QueryProvider } from '../providers/QueryProvider.js';
import { useServerDetailQuery, useServerListQuery } from './useServerQuery.js';
import { ServerQueryError } from '../lib/server-query-client.js';

it('separates owners and contexts, canonicalizes filters, and retains rows only across pagination', () => {
  const scope = { context: 'customer' as const, ownerId: 'profile-a', revision: 1 };
  const first = queryKeys.invoices.list(
    scope,
    new URLSearchParams('offset=0&status=unpaid&limit=25')
  );
  expect(first).toEqual(
    queryKeys.invoices.list(scope, new URLSearchParams('limit=25&status=unpaid&offset=0'))
  );
  const next = queryKeys.invoices.list(
    scope,
    new URLSearchParams('offset=25&status=unpaid&limit=25')
  );
  expect(next).not.toEqual(first);
  expect(sameServerList(first, next)).toBe(true);
  for (const change of [
    { ...scope, ownerId: 'profile-b' },
    { ...scope, revision: 2 },
    { ...scope, context: 'staff' as const },
  ])
    expect(
      sameServerList(
        first,
        queryKeys.invoices.list(change, new URLSearchParams('offset=25&status=unpaid&limit=25'))
      )
    ).toBe(false);
  expect(
    sameServerList(
      first,
      queryKeys.invoices.list(scope, new URLSearchParams('offset=25&status=paid&limit=25'))
    )
  ).toBe(false);
  expect(
    sameServerList(
      first,
      queryKeys.invoices.list(scope, new URLSearchParams('offset=25&status=unpaid&limit=50'))
    )
  ).toBe(false);
  expect(queryKeys.wallet.balance(scope)).not.toEqual(queryKeys.wallet.detail(scope, 'dashboard'));
  expect(() => queryKeys.profiles.all({ ...scope, ownerId: '' })).toThrow(
    'Query owner is required'
  );
});

it('holds previous rows during pagination, aborts abandoned reads and refuses another owner’s late response', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const requests: { signal: AbortSignal; resolve: (data: string) => void }[] = [];
  function Reader({ owner, offset }: { owner: string; offset: number }) {
    const query = useServerListQuery({
      queryKey: queryKeys.orders.list(
        { context: 'customer', ownerId: owner, revision: 0 },
        new URLSearchParams({ offset: String(offset), limit: '25' })
      ),
      read: (signal) => new Promise<string>((resolve) => requests.push({ signal, resolve })),
    });
    return <span data-previous={query.isPlaceholderData}>{query.data ?? 'loading'}</span>;
  }
  const render = (owner: string, offset: number) =>
    act(async () =>
      root.render(
        <QueryProvider>
          <Reader owner={owner} offset={offset} />
        </QueryProvider>
      )
    );
  try {
    await render('a', 0);
    await act(async () => requests[0]!.resolve('page one of a'));
    await vi.waitFor(() => expect(host.textContent).toBe('page one of a'));
    await render('a', 25);
    expect(host.textContent).toBe('page one of a');
    expect(host.firstElementChild?.getAttribute('data-previous')).toBe('true');
    await render('b', 0);
    expect(requests[1]!.signal.aborted).toBe(true);
    expect(host.textContent).toBe('loading');
    await act(async () => requests[1]!.resolve('private page two of a'));
    expect(host.textContent).toBe('loading');
    await act(async () => requests[2]!.resolve('current b'));
    await vi.waitFor(() => expect(host.textContent).toBe('current b'));
    await render('b', 25);
    await act(async () => root.render(null));
    expect(requests[3]!.signal.aborted).toBe(true);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('forces financial reads to stay manual even under an aggressive caller client and never retries denial', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: 3, refetchInterval: 10, refetchOnWindowFocus: true } },
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let denied = false;
  const read = vi.fn(async () => {
    if (denied) throw new ServerQueryError(403);
    return '9007199254740993';
  });
  function Reader() {
    const query = useServerDetailQuery({
      queryKey: queryKeys.wallet.balance({ context: 'customer', ownerId: 'a', revision: 0 }),
      read,
    });
    return (
      <button onClick={() => void query.refetch()}>
        {query.isError ? 'denied' : (query.data ?? 'loading')}
      </button>
    );
  }
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Reader />
        </QueryClientProvider>
      )
    );
    await vi.waitFor(() => expect(host.textContent).toBe('9007199254740993'));
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(1);
    denied = true;
    await act(async () => host.querySelector('button')!.click());
    await vi.waitFor(() => expect(host.textContent).toBe('denied'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
    focusManager.setFocused(undefined);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
