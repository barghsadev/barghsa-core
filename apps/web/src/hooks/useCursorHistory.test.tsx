import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useCursorHistory } from './useCursorHistory.js';

it('resets pages and cursors on filter changes and ignores a stale page response', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  const root = createRoot(host);
  let history!: ReturnType<typeof useCursorHistory<{ id: string }>>;
  function Harness({ scope }: { scope: string }) {
    history = useCursorHistory<{ id: string }>(scope);
    return <span>{history.items.map((item) => item.id).join(',')}</span>;
  }
  try {
    await act(async () => root.render(<Harness scope="completed" />));
    await act(async () => history.acceptPage([{ id: 'first' }], 'first'));
    await act(async () => history.loadMore());
    expect(history.before).toBe('first');
    await act(async () => history.acceptPage([{ id: 'first' }, { id: 'older' }], null));
    expect(host.textContent).toBe('first,older');
    const oldResponse = history.acceptPage;
    await act(async () => root.render(<Harness scope="submitted" />));
    expect(history.before).toBeUndefined();
    expect(history.items).toEqual([]);
    await act(async () => oldResponse([{ id: 'stale' }], 'stale'));
    expect(history.items).toEqual([]);
    await act(async () => history.acceptPage([{ id: 'new' }], null));
    await act(async () => root.render(<Harness scope="completed" />));
    expect(history.before).toBeUndefined();
    expect(history.items).toEqual([]);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
