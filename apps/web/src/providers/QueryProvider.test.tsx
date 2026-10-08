import { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  focusManager,
  onlineManager,
  QueryObserver,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { QueryProvider } from './QueryProvider.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import {
  createServerQueryClient,
  ServerQueryError,
  financialQueryResources,
} from '../lib/server-query-client.js';

it('bounds transient retries and opts every financial resource out of automatic refresh and retry', () => {
  const client = createServerQueryClient();
  try {
    const options = client.getDefaultOptions().queries!;
    expect(options).toMatchObject({
      staleTime: 30_000,
      gcTime: 300_000,
      refetchOnWindowFocus: true,
      refetchOnMount: true,
      refetchInterval: false,
    });
    const retry = options.retry;
    if (typeof retry !== 'function') throw new Error('Expected bounded retry policy');
    expect(retry(0, new ServerQueryError(503))).toBe(true);
    expect(retry(1, new ServerQueryError(503))).toBe(true);
    expect(retry(2, new ServerQueryError(503))).toBe(false);
    for (const status of [400, 401, 403, 404, 409, 422])
      expect(retry(0, new ServerQueryError(status))).toBe(false);
    expect(retry(0, new ServerQueryError(429))).toBe(true);
    expect(client.getDefaultOptions().mutations?.retry).toBe(false);
    for (const resource of financialQueryResources) {
      expect(
        client.defaultQueryOptions({ queryKey: ['barghsa', resource, 'profile-a'] })
      ).toMatchObject({
        staleTime: 0,
        gcTime: 0,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchInterval: false,
      });
    }
  } finally {
    client.clear();
  }
});

it('refreshes stale ordinary reads on focus while financial reads wait for an explicit refresh', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-08T09:00:00Z'));
  const client = createServerQueryClient(),
    walletRead = vi.fn(async () => '9007199254740993'),
    catalogueRead = vi.fn(async () => 'published catalogue'),
    wallet = new QueryObserver(client, {
      queryKey: ['barghsa', 'wallet', 'profile-a'],
      queryFn: walletRead,
    }),
    catalogue = new QueryObserver(client, {
      queryKey: ['barghsa', 'catalogue', 'profile-a'],
      queryFn: catalogueRead,
    });
  client.mount();
  const stopWallet = wallet.subscribe(() => {}),
    stopCatalogue = catalogue.subscribe(() => {});
  try {
    await vi.waitFor(() => expect(wallet.getCurrentResult().data).toBe('9007199254740993'));
    await vi.waitFor(() => expect(catalogue.getCurrentResult().data).toBe('published catalogue'));
    expect(walletRead).toHaveBeenCalledTimes(1);
    expect(catalogueRead).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_001);
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await vi.waitFor(() => expect(catalogueRead).toHaveBeenCalledTimes(2));
    expect(walletRead).toHaveBeenCalledTimes(1);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(walletRead).toHaveBeenCalledTimes(1);
    await wallet.refetch();
    expect(walletRead).toHaveBeenCalledTimes(2);
    expect(wallet.getCurrentResult().data).toBe('9007199254740993');
  } finally {
    stopWallet();
    stopCatalogue();
    client.unmount();
    client.clear();
    focusManager.setFocused(undefined);
    onlineManager.setOnline(true);
    vi.useRealTimers();
  }
});

it('deduplicates reads, aborts the discarded cache and ignores late results after a profile revision', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host),
    requests: { signal: AbortSignal; resolve: (value: string) => void }[] = [],
    clients: ReturnType<typeof useQueryClient>[] = [];
  const read = vi.fn(
    ({ signal }: { signal: AbortSignal }) =>
      new Promise<string>((resolve) => requests.push({ signal, resolve }))
  );
  function Reader() {
    const client = useQueryClient();
    if (!clients.includes(client)) clients.push(client);
    const query = useQuery({ queryKey: ['barghsa', 'profiles', 'test-owner'], queryFn: read });
    return <span>{query.data ?? 'loading'}</span>;
  }
  try {
    await act(async () =>
      root.render(
        <QueryProvider>
          <Reader />
          <Reader />
        </QueryProvider>
      )
    );
    expect(read).toHaveBeenCalledTimes(1);
    expect(host.textContent).toBe('loadingloading');
    await act(async () => refreshProfileContext());
    expect(requests[0]!.signal.aborted).toBe(true);
    expect(clients).toHaveLength(2);
    expect(clients[0]!.getQueryCache().getAll()).toHaveLength(0);
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => requests[0]!.resolve('private previous profile'));
    expect(host.textContent).toBe('loadingloading');
    await act(async () => requests[1]!.resolve('current profile'));
    await vi.waitFor(() => expect(host.textContent).toBe('current profilecurrent profile'));
    await act(async () => root.render(null));
    expect(clients[1]!.getQueryCache().getAll()).toHaveLength(0);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
