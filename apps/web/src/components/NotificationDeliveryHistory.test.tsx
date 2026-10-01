import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { NotificationDeliveryHistory } from './NotificationDeliveryHistory.js';
vi.mock('../hooks/useTimezone.js', () => ({
  useTimezone: () => ({ status: 'ready', timezone: 'UTC', retry: () => {} }),
}));

it('resubmitting the same applied history search refreshes its exact query and supports recovery', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let fail = false;
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
      root.render(<NotificationDeliveryHistory locale="en" onClose={() => {}} />)
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
