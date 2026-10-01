import { act, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useCatalogueResource, useCatalogueScope } from './useCatalogueResource.js';
const validate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
it('a validated save receipt supersedes older reads and cannot cross a denied scope', async () => {
  let resolve!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        })
    )
  );
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let path = '/catalogue';
  let resource!: ReturnType<typeof useCatalogueResource<number>>;
  let scope!: ReturnType<typeof useCatalogueScope>;
  function Harness() {
    scope = useCatalogueScope(useCallback(() => {}, []));
    resource = useCatalogueResource(scope, path, validate);
    return <p>{resource.data ?? 'unavailable'}</p>;
  }
  try {
    await act(async () => root.render(<Harness />));
    const oldAccept = resource.accept;
    await act(async () => {
      expect(resource.accept(72)).toBe(true);
    });
    await act(async () => resolve(new Response('24')));
    expect(host.textContent).toBe('72');
    await act(async () => {
      expect(resource.accept(NaN)).toBe(false);
    });
    expect(host.textContent).toBe('72');
    path = '/other';
    await act(async () => root.render(<Harness />));
    await act(async () => {
      expect(oldAccept(96)).toBe(false);
    });
    await act(async () => resolve(new Response('18')));
    expect(host.textContent).toBe('18');
    await act(async () => scope.deny());
    await act(async () => {
      expect(oldAccept(48)).toBe(false);
    });
    expect(host.textContent).toBe('unavailable');
    await act(async () => scope.recover());
    await act(async () => {
      expect(oldAccept(96)).toBe(false);
    });
    await act(async () => resolve(new Response('36')));
    expect(host.textContent).toBe('36');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
