import { QueryProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AccountUserProvider } from './useAccountUser.js';
import { useGeographyOptions } from './useGeographyOptions.js';

for (const invalid of [
  { status: 503, data: [] },
  { status: 200, data: {} },
  { status: 200, data: [{ id: 'c', nameFa: 'شهر', nameEn: 'City', provinceId: 'wrong' }] },
  { status: 200, data: [{ id: 'c', nameFa: '', nameEn: 'City', provinceId: 'a' }] },
  {
    status: 200,
    data: Array(2).fill({ id: 'c', nameFa: 'شهر', nameEn: 'City', provinceId: 'a' }),
  },
]) {
  it(`rejects invalid city catalogues and recovers with an independent retry: ${JSON.stringify(invalid)}`, async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const requests = vi
      .fn()
      .mockResolvedValueOnce(Response.json(invalid.data, { status: invalid.status }))
      .mockResolvedValueOnce(
        Response.json([{ id: 'c', nameFa: 'شهر', nameEn: 'City', provinceId: 'a' }])
      );
    vi.stubGlobal('fetch', requests);
    function Consumer() {
      const state = useGeographyOptions('/provinces/a/cities', 'a');
      return (
        <>
          <input defaultValue="Unrelated address draft" />
          <output>
            {JSON.stringify({ options: state.options, ready: state.ready, error: state.error })}
          </output>
          <button onClick={state.retry}>Retry</button>
        </>
      );
    }
    try {
      await act(async () =>
        root.render(
          <QueryProvider>
            <Consumer />
          </QueryProvider>
        )
      );
      expect(JSON.parse(host.querySelector('output')!.textContent!)).toEqual({
        options: [],
        ready: false,
        error: true,
      });
      await act(async () => host.querySelector('button')!.click());
      expect(JSON.parse(host.querySelector('output')!.textContent!)).toEqual({
        options: [{ id: 'c', nameFa: 'شهر', nameEn: 'City', provinceId: 'a' }],
        ready: true,
        error: false,
      });
      expect(host.querySelector('input')!.value).toBe('Unrelated address draft');
      expect(requests).toHaveBeenCalledTimes(2);
      expect(requests.mock.calls.map(([path]) => path)).toEqual([
        '/provinces/a/cities',
        '/provinces/a/cities',
      ]);
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });
}

for (const nextProvince of ['b', null]) {
  it(`ignores a late city response after the province changes to ${nextProvince}`, async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    let finishOld!: (response: Response) => void;
    const old = new Promise<Response>((resolve) => {
      finishOld = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string) =>
        path.includes('/a/')
          ? old
          : Promise.resolve(
              Response.json([{ id: 'city-b', provinceId: 'b', nameFa: 'شهر ب', nameEn: 'City B' }])
            )
      )
    );
    function Consumer({ province }: { province: string | null }) {
      const state = useGeographyOptions(
        province ? `/provinces/${province}/cities` : null,
        province ?? undefined
      );
      return (
        <output>
          {JSON.stringify({
            options: state.options.map((row) => row.id),
            ready: state.ready,
            loading: state.loading,
            error: state.error,
          })}
        </output>
      );
    }
    try {
      await act(async () =>
        root.render(
          <QueryProvider>
            <Consumer province="a" />
          </QueryProvider>
        )
      );
      await act(async () =>
        root.render(
          <QueryProvider>
            <Consumer province={nextProvince} />
          </QueryProvider>
        )
      );
      const expected = {
        options: nextProvince ? ['city-b'] : [],
        ready: nextProvince !== null,
        loading: false,
        error: false,
      };
      expect(JSON.parse(host.textContent!)).toEqual(expected);
      await act(async () =>
        finishOld(
          Response.json([{ id: 'city-a', provinceId: 'a', nameFa: 'شهر الف', nameEn: 'City A' }])
        )
      );
      expect(JSON.parse(host.textContent!)).toEqual(expected);
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });
}

it('matching account readers share an initial transport, while removing one cannot cancel the other', async () => {
  const host = document.createElement('div'),
    root = createRoot(host);
  const requests = vi.fn<(path: string, init: RequestInit) => Promise<Response>>(
    () => new Promise<Response>(() => {})
  );
  vi.stubGlobal('fetch', requests);
  function Consumer() {
    useGeographyOptions('/provinces');
    return null;
  }
  const render = (count: number) =>
    root.render(
      <QueryProvider>
        <AccountUserProvider value="account">
          {Array.from({ length: count }, (_, i) => (
            <Consumer key={i} />
          ))}
        </AccountUserProvider>
      </QueryProvider>
    );
  try {
    await act(async () => render(2));
    expect(requests).toHaveBeenCalledTimes(1);
    const signal = requests.mock.calls[0]![1].signal as AbortSignal;
    await act(async () => render(1));
    expect(signal.aborted).toBe(false);
    await act(async () => render(0));
    expect(signal.aborted).toBe(true);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
it('each reader retries freshly, hides previous choices and does not refetch on focus or reconnect', async () => {
  const host = document.createElement('div'),
    root = createRoot(host);
  const option = { id: 'p', nameFa: 'استان', nameEn: 'Province' };
  const states: ReturnType<typeof useGeographyOptions>[] = [];
  let finish!: (response: Response) => void;
  const requests = vi
    .fn()
    .mockResolvedValueOnce(Response.json([option]))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValueOnce(Response.json([option]));
  vi.stubGlobal('fetch', requests);
  function Consumer({ index }: { index: number }) {
    states[index] = useGeographyOptions('/provinces');
    return null;
  }
  try {
    await act(async () =>
      root.render(
        <QueryProvider>
          <AccountUserProvider value="account">
            <Consumer index={0} />
            <Consumer index={1} />
          </AccountUserProvider>
        </QueryProvider>
      )
    );
    expect(requests).toHaveBeenCalledTimes(1);
    expect(states.every((state) => state.ready)).toBe(true);
    await act(async () => states[0]!.retry());
    expect(states[0]!.options).toEqual([]);
    expect(states[0]!.ready).toBe(false);
    expect(states[1]!.options).toEqual([option]);
    await act(async () => states[1]!.retry());
    expect(requests).toHaveBeenCalledTimes(3);
    expect(states[0]!.loading).toBe(true);
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    await act(async () => {});
    expect(requests).toHaveBeenCalledTimes(3);
    await act(async () => finish(Response.json([option])));
    expect(states.every((state) => state.ready)).toBe(true);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
it('account replacement withdraws old choices during the new read and ignores a late old result', async () => {
  const host = document.createElement('div'),
    root = createRoot(host);
  const oldOption = { id: 'old', nameFa: 'پیشین', nameEn: 'Old' };
  let state!: ReturnType<typeof useGeographyOptions>;
  let old!: (response: Response) => void, next!: (response: Response) => void;
  const requests = vi
    .fn()
    .mockResolvedValueOnce(Response.json([oldOption]))
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
  vi.stubGlobal('fetch', requests);
  function Consumer() {
    state = useGeographyOptions('/provinces');
    return null;
  }
  const render = (account: string) =>
    root.render(
      <QueryProvider>
        <AccountUserProvider value={account}>
          <Consumer />
        </AccountUserProvider>
      </QueryProvider>
    );
  try {
    await act(async () => render('a'));
    expect(state.options).toEqual([oldOption]);
    await act(async () => state.retry());
    const signal = requests.mock.calls[1]![1].signal as AbortSignal;
    await act(async () => render('b'));
    expect(state.options).toEqual([]);
    expect(state.ready).toBe(false);
    expect(signal.aborted).toBe(true);
    await act(async () => old(Response.json([oldOption])));
    expect(state.options).toEqual([]);
    await act(async () => next(Response.json([{ ...oldOption, id: 'new' }])));
    expect(state.options.map((option) => option.id)).toEqual(['new']);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
