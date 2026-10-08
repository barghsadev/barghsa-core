import { act, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { QueryProvider } from '../test/query-provider.js';
import { AccountUserProvider } from './useAccountUser.js';
import { useCatalogueScope } from './useCatalogueResource.js';
import { useGeographyList, type GeographyPage } from './useGeographyList.js';
import { GeographyRequestError, type Province } from '../lib/geography-api.js';

const data = (name: string): GeographyPage<Province> => ({
  rows: [{ id: name, nameFa: name, nameEn: name, status: 'active' }],
  total: 40,
});
it('retains the accepted page after navigation failure and explicitly retries the failed page', async () => {
  const host = document.createElement('div'),
    root = createRoot(host);
  let list!: ReturnType<typeof useGeographyList<Province>>;
  const load = vi.fn(async (page: number) => data(`page-${page}`));
  function Harness({ page }: { page: number }) {
    const scope = useCatalogueScope(useCallback(() => {}, []));
    list = useGeographyList(
      scope,
      '',
      page,
      load,
      useCallback(() => {}, [])
    );
    return <p>{list.data?.rows[0]?.id}</p>;
  }
  const render = (page: number) =>
    root.render(
      <QueryProvider>
        <Harness page={page} />
      </QueryProvider>
    );
  try {
    await act(async () => render(1));
    load.mockRejectedValueOnce(new Error('offline'));
    await act(async () => render(2));
    expect(host.textContent).toBe('page-1');
    expect(list.acceptedPage).toBe(1);
    expect(list.error).toBe(true);
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    await act(async () => {});
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => list.retry());
    expect(load.mock.calls.map(([page]) => page)).toEqual([1, 2, 2]);
    expect(list.acceptedPage).toBe(2);
    expect(host.textContent).toBe('page-2');
    await act(async () => render(1));
    expect(load.mock.calls.map(([page]) => page)).toEqual([1, 2, 2, 1]);
  } finally {
    await act(async () => root.unmount());
  }
});
it('withdraws old-account data, cancels its transport, and ignores a late denial', async () => {
  const host = document.createElement('div'),
    root = createRoot(host);
  let list!: ReturnType<typeof useGeographyList<Province>>;
  let account = 'a',
    hold = false;
  let old!: { signal: AbortSignal; reject: (reason: unknown) => void };
  const denied = vi.fn();
  const load = vi.fn(async (_page: number, signal: AbortSignal) => {
    if (hold)
      return new Promise<GeographyPage<Province>>((_yes, reject) => {
        old = { signal, reject };
      });
    return data(account);
  });
  function Harness() {
    const scope = useCatalogueScope(denied);
    list = useGeographyList(
      scope,
      '',
      1,
      load,
      useCallback(() => {}, [])
    );
    return <p>{list.data?.rows[0]?.id ?? 'unavailable'}</p>;
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
    await act(async () => list.retry());
    account = 'b';
    hold = false;
    await act(async () => render());
    expect(host.textContent).toBe('b');
    expect(old.signal.aborted).toBe(true);
    hold = false;
    await act(async () => old.reject(new GeographyRequestError('denied')));
    expect(denied).not.toHaveBeenCalled();
    expect(host.textContent).toBe('b');
    hold = true;
    await act(async () => list.retry());
    await act(async () => root.unmount());
    expect(load.mock.calls.at(-1)![1].aborted).toBe(true);
  } finally {
    await act(async () => root.unmount());
  }
});
