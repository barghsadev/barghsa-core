import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import CustomerCorrectionsPanel from './CustomerCorrectionsPanel.js';

vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ notice: null, format: (value: string) => value }),
}));

it('retries a stalled staff correction list and never accepts a timed-out private reply', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  vi.useFakeTimers();
  let stalled!: AbortSignal,
    complete!: (value: unknown) => void,
    loads = 0;
  const row = {
    id: '11111111-1111-4111-8111-111111111111',
    address: 'current@example.test',
    profileId: null,
    createdAt: '2026-11-07T10:00:00Z',
    resolvedAt: null,
    resolutionNote: null,
  };
  const fetcher = vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/access')) return Response.json({ canView: true, canRetry: false });
    expect(path).toBe('/api/admin/notifications/customer-corrections?completed=false&offset=0');
    expect(init.method).toBeUndefined();
    if (++loads > 1) return Response.json([row]);
    stalled = init.signal!;
    return {
      ok: true,
      json: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    };
  });
  vi.stubGlobal('fetch', fetcher);
  try {
    await act(async () => root.render(<CustomerCorrectionsPanel locale="en" />));
    expect(stalled.aborted).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(stalled.aborted).toBe(true);
    expect(container.querySelector('[role=alert]')).not.toBeNull();
    const retry = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Refresh corrections'
    );
    expect(retry).toBeDefined();
    await act(async () => retry!.click());
    expect(container.querySelector('[role=alert]')).toBeNull();
    expect(container.textContent).toContain(row.address);
    expect(fetcher).toHaveBeenCalledTimes(4);
    await act(async () => complete([{ ...row, address: 'obsolete@example.test' }]));
    expect(container.textContent).not.toContain('obsolete@example.test');
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
