import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useAccountTime } from './useAccountTime.js';
let root: Root, host: HTMLDivElement;
const stamp = '2026-01-01T01:00:00Z';
function Screen() {
  const time = useAccountTime();
  return (
    <>
      {time.notice}
      <time>{time.format(stamp)}</time>
      <span>{time.format('bad')}</span>
    </>
  );
}
beforeEach(() => {
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it('shows no guessed time on failure, then retries the saved account timezone', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(new Response('{}', { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ timezone: 'America/Los_Angeles' })));
  vi.stubGlobal('fetch', request);
  await act(async () => root.render(<Screen />));
  expect(host.querySelector('[role=alert]')).not.toBeNull();
  expect(host.querySelector('time')!.textContent).toBe('Time unavailable');
  await act(async () => host.querySelector('button')!.click());
  expect(host.querySelector('[role=alert]')).toBeNull();
  expect(host.querySelector('time')!.textContent).toBe('Dec 31, 2025, 5:00 PM');
  expect(host.querySelector('span')!.textContent).toBe('Invalid timestamp');
  expect(request).toHaveBeenCalledTimes(2);
});
it('refreshes dates after the account timezone changes', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ timezone: 'America/Los_Angeles' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ timezone: 'Asia/Tokyo' })))
  );
  await act(async () => root.render(<Screen />));
  await act(async () => {
    window.dispatchEvent(new Event('barghsa:timezone-changed'));
  });
  expect(host.querySelector('time')!.textContent).toBe('Jan 1, 2026, 10:00 AM');
});
