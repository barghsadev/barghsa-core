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
