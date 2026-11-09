import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { NotificationDeliveryHistory } from './NotificationDeliveryHistory.js';
import { QueryComponentProvider } from '../test/query-provider.js';
vi.mock('../hooks/useTimezone.js', () => ({
  useTimezone: () => ({ status: 'ready', timezone: 'UTC', retry: () => {} }),
}));

it('resubmitting the same applied history search refreshes its exact query and supports recovery', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let fail = false;
  const denied = vi.fn();
  const requests: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return new Response('[]', { status: fail ? 503 : 200 });
    })
  );
  try {
    await act(async () =>
      root.render(
        <QueryComponentProvider>
          <NotificationDeliveryHistory locale="en" onClose={() => {}} onDenied={denied} />
        </QueryComponentProvider>
      )
    );
    expect(requests).toHaveLength(1);
    fail = true;
    await act(async () =>
      document
        .querySelector('[role=dialog] form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    expect(requests).toHaveLength(2);
    expect(requests[1]).toBe(requests[0]);
    expect(document.querySelector('[role=dialog] [role=alert]')).not.toBeNull();
    expect(denied).not.toHaveBeenCalled();
    fail = false;
    const retry = [...document.querySelectorAll<HTMLButtonElement>('[role=dialog] button')].find(
      (button) => button.textContent?.trim() === 'Try again'
    );
    expect(retry).toBeDefined();
    await act(async () => retry!.click());
    expect(requests).toHaveLength(3);
    expect(requests[2]).toBe(requests[0]);
    expect(document.querySelector('[role=dialog] [role=alert]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('retains the prior page during paging and clears private rows when the next read is denied', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let finish!: (response: Response) => void;
  const denied = vi.fn();
  const entries = Array.from({ length: 26 }, (_, index) => ({
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    notificationId: '20000000-0000-4000-8000-000000000001',
    channel: 'email',
    status: 'delivered',
    attemptNumber: 1,
    providerRef: 'Verified first-page receipt',
    latencyMs: 42,
    errorCategory: null,
    errorDetail: null,
    createdAt: '2026-10-30T00:00:00Z',
  }));
  const fetcher = vi.fn((input: RequestInfo | URL) =>
    String(input).includes('offset=25')
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(Response.json(entries))
  );
  vi.stubGlobal('fetch', fetcher);
  try {
    await act(async () =>
      root.render(
        <QueryComponentProvider>
          <NotificationDeliveryHistory locale="en" onClose={() => {}} onDenied={denied} />
        </QueryComponentProvider>
      )
    );
    const dialog = document.querySelector('[role=dialog]')!;
    expect(dialog.textContent).toContain('Verified first-page receipt');
    const next = [...dialog.querySelectorAll('button')].find(
      (button) => button.textContent === 'Next'
    )!;
    await act(async () => next.click());
    expect(next.disabled).toBe(true);
    expect(dialog.querySelector('[aria-busy=true]')?.textContent).toContain(
      'Verified first-page receipt'
    );
    await act(async () => finish(Response.json({}, { status: 403 })));
    expect(dialog.querySelector('[role=alert]')).not.toBeNull();
    expect(dialog.textContent).not.toContain('Verified first-page receipt');
    expect(denied).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
