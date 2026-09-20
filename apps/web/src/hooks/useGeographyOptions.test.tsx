import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useGeographyOptions } from './useGeographyOptions.js';

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
