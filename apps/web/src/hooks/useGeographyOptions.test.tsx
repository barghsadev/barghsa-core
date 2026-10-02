import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
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
      await act(async () => root.render(<Consumer />));
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
      await act(async () => root.render(<Consumer province="a" />));
      await act(async () => root.render(<Consumer province={nextProvince} />));
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
