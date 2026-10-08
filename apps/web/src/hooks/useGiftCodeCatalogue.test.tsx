import { QueryProvider } from '../test/query-provider.js';
import { act, useCallback, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useGiftCodeCatalogue } from './useGiftCodeCatalogue.js';
import { AccountUserProvider } from './useAccountUser.js';
import { useCatalogueScope } from './useCatalogueResource.js';
import { useListQuery } from './useListQuery.js';
import { giftFilter, giftListSearch, giftQueryOptions } from '../lib/gift-list-query.js';
import { giftCode } from '../test/gift-code-fixtures.js';
const first = Array.from({ length: 50 }, (_, i) => giftCode(i));
const cursor = giftCode(49).id;
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const roots: { root: Root; host: HTMLDivElement }[] = [];
afterEach(async () => {
  for (const { root, host } of roots.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
  vi.unstubAllGlobals();
});
const waitFor = vi.waitFor;
async function mountHook<T>(hook: () => T) {
  const result = { current: undefined as T | undefined };
  function Probe() {
    result.current = hook();
    return null;
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push({ root, host });
  await act(async () => root.render(<QueryProvider>{<Probe />}</QueryProvider>));
  return { result: result as { current: T } };
}
async function mount(initial: Record<string, unknown> = {}) {
  const onDenied = vi.fn();
  return mountHook(() => {
    const [raw, setRaw] = useState(initial);
    const queries = useListQuery(giftQueryOptions, giftListSearch(raw), (update) =>
      setRaw((old) => giftListSearch(update(old)))
    );
    const scope = useCatalogueScope(onDenied);
    const catalogue = useGiftCodeCatalogue(scope, giftFilter(queries.query.filters), true, queries);
    return { catalogue, raw, setRaw, scope };
  });
}
it('restores a later cursor and retries its initial failure with the exact query', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response({}, 503))
    .mockResolvedValueOnce(response([giftCode(50)]));
  vi.stubGlobal('fetch', fetch);
  const { result } = await mount({ search: 'CODE', cursor });
  await waitFor(() => expect(result.current.catalogue.error).toBe(true));
  await act(async () => result.current.catalogue.retry());
  await waitFor(() => expect(result.current.catalogue.rows).toHaveLength(1));
  expect(fetch.mock.calls.map((call) => call[0])).toEqual(
    Array(2).fill(`/api/admin/promotions/gift-codes?search=CODE&limit=50&before=${cursor}`)
  );
  expect(result.current.raw.cursor).toBe(cursor);
});
it('retains accepted rows after a failed next page, retries exactly and deduplicates overlaps', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(first))
    .mockResolvedValueOnce(response({}, 503))
    .mockResolvedValueOnce(response([giftCode(49), giftCode(50)]))
    .mockResolvedValueOnce(response(first));
  vi.stubGlobal('fetch', fetch);
  const { result } = await mount();
  await waitFor(() => expect(result.current.catalogue.rows).toHaveLength(50));
  await act(async () => result.current.catalogue.loadMore());
  await waitFor(() => expect(result.current.catalogue.more).toBe('error'));
  expect(result.current.catalogue.rows).toHaveLength(50);
  expect(result.current.raw.cursor).toBe(cursor);
  await act(async () => result.current.catalogue.loadMore());
  await waitFor(() => expect(result.current.catalogue.rows).toHaveLength(51));
  expect(fetch.mock.calls[1]![0]).toBe(fetch.mock.calls[2]![0]);
  expect(result.current.catalogue.hasMore).toBe(false);
  await act(async () => result.current.setRaw({}));
  await waitFor(() => expect(result.current.catalogue.rows).toHaveLength(50));
  expect(result.current.catalogue.rows?.some((row) => row.id === giftCode(50).id)).toBe(false);
});
it('rejects a cursor cycle without accepting the page or dropping previous rows', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(first))
    .mockResolvedValueOnce(response(first));
  vi.stubGlobal('fetch', fetch);
  const { result } = await mount();
  await waitFor(() => expect(result.current.catalogue.rows).toHaveLength(50));
  await act(async () => result.current.catalogue.loadMore());
  await waitFor(() => expect(result.current.catalogue.more).toBe('error'));
  expect(result.current.catalogue.rows).toHaveLength(50);
  expect(result.current.catalogue.pending).toBe(true);
});
it('ignores a delayed page and clears previous rows when applied criteria change', async () => {
  let settle!: (value: Response) => void;
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(first))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          settle = resolve;
        })
    )
    .mockResolvedValueOnce(response([{ ...giftCode(80), status: 'inactive' }]));
  vi.stubGlobal('fetch', fetch);
  const { result } = await mount();
  await waitFor(() => expect(result.current.catalogue.rows).toHaveLength(50));
  await act(async () => result.current.catalogue.loadMore());
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  await act(async () => result.current.setRaw({ status: 'inactive' }));
  await waitFor(() => expect(result.current.catalogue.rows?.[0]?.id).toBe(giftCode(80).id));
  await act(async () => settle(response([giftCode(50)])));
  expect(result.current.catalogue.rows?.map((row) => row.id)).toEqual([giftCode(80).id]);
});
it('permission denial discards private results and recovery keeps the current public URL scope', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response([giftCode(50)]))
    .mockResolvedValueOnce(response({}, 403))
    .mockResolvedValueOnce(response([giftCode(50)]));
  vi.stubGlobal('fetch', fetch);
  const { result } = await mount({ cursor });
  await waitFor(() => expect(result.current.catalogue.rows).toHaveLength(1));
  // A failed restored page retries the current cursor; explicit refresh otherwise returns to the first page.
  await act(async () => result.current.scope.deny());
  await waitFor(() => expect(result.current.catalogue.rows).toBeNull());
  await act(async () => result.current.scope.recover());
  await waitFor(() => expect(result.current.scope.denied).toBe(true));
  expect(result.current.catalogue.rows).toBeNull();
  await act(async () => result.current.scope.recover());
  await waitFor(() => expect(result.current.catalogue.rows).toHaveLength(1));
  expect(result.current.raw.cursor).toBe(cursor);
});
it('standalone consumers keep appended pages and explicit refresh returns to the first page', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(first))
    .mockResolvedValueOnce(response([giftCode(50)]))
    .mockResolvedValueOnce(response([giftCode()]));
  vi.stubGlobal('fetch', fetch);
  const clear = vi.fn();
  const { result } = await mountHook(() =>
    useGiftCodeCatalogue(useCatalogueScope(clear), '', true)
  );
  await waitFor(() => expect(result.current.rows).toHaveLength(50));
  await act(async () => result.current.loadMore());
  await waitFor(() => expect(result.current.rows).toHaveLength(51));
  await act(async () => result.current.retry());
  await waitFor(() => expect(result.current.rows).toHaveLength(1));
  expect(fetch.mock.calls[2]![0]).toBe('/api/admin/promotions/gift-codes?limit=50');
});
it('confirmed receipts supersede delayed read failures without replaying writes or auto-fetching', async () => {
  let settle!: (value: Response) => void;
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response([giftCode()]))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          settle = resolve;
        })
    )
    .mockResolvedValueOnce(response([{ ...giftCode(), status: 'inactive' }]));
  vi.stubGlobal('fetch', fetch);
  const { result } = await mount();
  await waitFor(() => expect(result.current.catalogue.rows).toHaveLength(1));
  await act(async () => result.current.catalogue.retry());
  const signal = fetch.mock.calls[1]![1].signal as AbortSignal;
  await act(async () => result.current.catalogue.accept({ ...giftCode(), status: 'inactive' }));
  await act(async () => settle(response({}, 403)));
  expect(result.current.scope.denied).toBe(false);
  expect(result.current.catalogue.rows?.[0]?.status).toBe('inactive');
  window.dispatchEvent(new Event('focus'));
  window.dispatchEvent(new Event('online'));
  await act(async () => {});
  expect(fetch).toHaveBeenCalledTimes(2);
  await act(async () => result.current.catalogue.retry());
  await waitFor(() => expect(result.current.catalogue.pending).toBe(false));
  expect(result.current.catalogue.rows?.[0]?.status).toBe('inactive');
  expect(fetch).toHaveBeenCalledTimes(3);
  // A new owner read uses a distinct key; completed transport cancellation is not required.
  expect(signal).toBeInstanceOf(AbortSignal);
});
it('disabling a catalogue cancels its pending page and cannot publish a delayed result', async () => {
  let settle!: (value: Response) => void;
  const fetch = vi.fn().mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        settle = resolve;
      })
  );
  vi.stubGlobal('fetch', fetch);
  const { result } = await mountHook(() => {
    const [enabled, setEnabled] = useState(true);
    const scope = useCatalogueScope(useCallback(() => {}, []));
    return { catalogue: useGiftCodeCatalogue(scope, '', enabled), setEnabled };
  });
  const signal = fetch.mock.calls[0]![1].signal as AbortSignal;
  await act(async () => result.current.setEnabled(false));
  expect(signal.aborted).toBe(true);
  expect(result.current.catalogue.rows).toBeNull();
  await act(async () => settle(response(first)));
  expect(result.current.catalogue.rows).toBeNull();
  expect(result.current.catalogue.pending).toBe(false);
});
it('account replacement withdraws accepted rows while the new read is pending and ignores old denial', async () => {
  const host = document.createElement('div'),
    root = createRoot(host);
  roots.push({ root, host });
  let catalogue!: ReturnType<typeof useGiftCodeCatalogue>;
  let old!: (value: Response) => void, next!: (value: Response) => void;
  const denied = vi.fn();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response([giftCode()]))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          old = resolve;
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          next = resolve;
        })
    );
  vi.stubGlobal('fetch', fetch);
  function Probe() {
    catalogue = useGiftCodeCatalogue(useCatalogueScope(denied), '', true);
    return <p>{catalogue.rows?.[0]?.code ?? 'unavailable'}</p>;
  }
  const render = (account: string) =>
    root.render(
      <QueryProvider>
        <AccountUserProvider value={account}>
          <Probe />
        </AccountUserProvider>
      </QueryProvider>
    );
  await act(async () => render('a'));
  expect(catalogue.rows).toHaveLength(1);
  await act(async () => catalogue.retry());
  const oldSignal = fetch.mock.calls[1]![1].signal as AbortSignal;
  await act(async () => render('b'));
  expect(catalogue.rows).toBeNull();
  expect(host.textContent).toBe('unavailable');
  expect(catalogue.pending).toBe(true);
  expect(oldSignal.aborted).toBe(true);
  await act(async () => old(response({}, 403)));
  expect(denied).not.toHaveBeenCalled();
  expect(catalogue.rows).toBeNull();
  await act(async () => next(response([giftCode(99)])));
  expect(catalogue.rows?.map((row) => row.id)).toEqual([giftCode(99).id]);
});
