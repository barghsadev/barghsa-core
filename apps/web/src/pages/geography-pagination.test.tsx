import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AdminGeographyPage from './AdminGeographyPage.js';
import { CitiesPanel } from './AdminCitiesPanel.js';

vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ number: String }),
}));
let root: Root, container: HTMLDivElement;
const queries: URLSearchParams[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  document.documentElement.lang = 'en';
  queries.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      queries.push(url.searchParams);
      const kind = url.pathname.endsWith('/cities') ? 'cities' : 'provinces';
      return {
        ok: true,
        json: async () => ({
          [kind]: [
            {
              id: 'item',
              provinceId: 'p1',
              nameFa: 'تهران',
              nameEn: url.searchParams.get('page') === '2' ? 'Second page' : 'First page',
              status: 'active',
            },
          ],
          total: 21,
        }),
      };
    })
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function button(name: string) {
  const result = Array.from(container.querySelectorAll('button')).find(
    (node) => node.textContent === name
  );
  expect(result).toBeTruthy();
  return result!;
}
for (const kind of ['provinces', 'cities']) {
  it(`${kind}: initial debounce cannot undo pagination, but a changed search resets it`, async () => {
    await act(async () =>
      root.render(
        kind === 'provinces' ? (
          <AdminGeographyPage />
        ) : (
          <CitiesPanel
            province={{ id: 'p1', nameFa: 'تهران', nameEn: 'Tehran', status: 'active' }}
          />
        )
      )
    );
    expect(container.textContent).toContain('First page');
    await act(async () => button('Next').click());
    expect(container.textContent).toContain('Second page');
    // Advance exactly the old mount timer after navigation, without real-time races.
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(button('Previous').disabled).toBe(false);
    expect(container.textContent).toContain('Second page');
    expect(queries.at(-1)?.get('page')).toBe('2');
    const input = container.querySelector('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        'Tehran'
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(queries.at(-1)?.get('search')).toBe('Tehran');
    expect(queries.at(-1)?.get('page')).toBe('1');
    expect(button('Previous').disabled).toBe(true);
  });
}

function pageFor(kind: string) {
  return kind === 'provinces' ? (
    <AdminGeographyPage />
  ) : (
    <CitiesPanel province={{ id: 'p1', nameFa: 'تهران', nameEn: 'Tehran', status: 'active' }} />
  );
}
function response(kind: string, total: number, name = 'Recovered') {
  return {
    ok: true,
    json: async () => ({
      [kind]: total
        ? [{ id: 'item', provinceId: 'p1', nameFa: 'تهران', nameEn: name, status: 'active' }]
        : [],
      total,
    }),
  } as Response;
}
for (const kind of ['provinces', 'cities']) {
  it(`${kind}: returns to an available page when the last page disappears`, async () => {
    const fetchMock = vi.mocked(fetch);
    await act(async () => root.render(pageFor(kind)));
    fetchMock.mockResolvedValue(response(kind, 1));
    await act(async () => button('Next').click());
    expect(container.textContent).toContain('Recovered');
    const pages = fetchMock.mock.calls
      .slice(-2)
      .map(([url]) => new URL(String(url), 'http://localhost').searchParams.get('page'));
    expect(pages).toEqual(['2', '1']);
    expect(container.querySelector('nav')).toBeNull();
  });
  it(`${kind}: retries a network failure and displays the empty result`, async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValue(response(kind, 0));
    await act(async () => root.render(pageFor(kind)));
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => button('Retry').click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('tbody td')?.getAttribute('colspan')).toBe('4');
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });
  for (const outcome of ['resolve', 'reject']) {
    it(`${kind}: ignores a stale request that later ${outcome}s`, async () => {
      let resolve!: (value: Response) => void;
      let reject!: (reason: Error) => void;
      vi.mocked(fetch).mockImplementationOnce(
        () =>
          new Promise<Response>((yes, no) => {
            resolve = yes;
            reject = no;
          })
      );
      await act(async () => root.render(pageFor(kind)));
      const firstSignal = vi.mocked(fetch).mock.calls[0]![1]!.signal!;
      await act(async () => {
        const select = container.querySelector('select')!;
        select.value = 'active';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(firstSignal.aborted).toBe(true);
      expect(container.textContent).toContain('First page');
      await act(async () => {
        if (outcome === 'resolve') resolve(response(kind, 1, 'Stale row'));
        else reject(new Error('late failure'));
      });
      expect(container.textContent).toContain('First page');
      expect(container.textContent).not.toContain('Stale row');
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    });
  }
}
