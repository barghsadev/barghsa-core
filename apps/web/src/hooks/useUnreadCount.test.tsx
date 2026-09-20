import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useUnreadCount } from './useUnreadCount.js';

let root: Root, host: HTMLDivElement, state: ReturnType<typeof useUnreadCount>;
const requests: Array<(response: Response) => void> = [];
function Consumer() {
  state = useUnreadCount();
  return <span>{state.unreadCount}</span>;
}
async function reply(count: number) {
  const resolve = requests.shift()!;
  await act(async () =>
    resolve(new Response(JSON.stringify({ unread_count: count }), { status: 200 }))
  );
}
beforeEach(async () => {
  vi.useFakeTimers();
  requests.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>((resolve) => requests.push(resolve)))
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <StrictMode>
        <Consumer />
      </StrictMode>
    )
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('ignores a count request started before a newer authoritative update', async () => {
  expect(requests).toHaveLength(1);
  await act(async () => state.setUnreadCount(2));
  await reply(8);
  expect(host.textContent).toBe('2');
  await act(async () => vi.advanceTimersByTime(30000));
  await reply(3);
  expect(host.textContent).toBe('3');
});
it('keeps optimistic reads stable until completion and resumes polling afterward', async () => {
  await reply(2);
  await act(async () => vi.advanceTimersByTime(30000));
  await act(async () => state.optimisticDecrement(2));
  await reply(2);
  expect(host.textContent).toBe('0');
  await act(async () => vi.advanceTimersByTime(60000));
  expect(requests).toHaveLength(0);
  await act(async () => state.setUnreadCount(2));
  await act(async () => vi.advanceTimersByTime(30000));
  await reply(1);
  expect(host.textContent).toBe('1');
});
it('does not overlap slow polls and cleans up after unmount', async () => {
  await act(async () => vi.advanceTimersByTime(90000));
  expect(requests).toHaveLength(1);
  await act(async () => root.render(null));
  await reply(5);
  await act(async () => vi.advanceTimersByTime(60000));
  expect(requests).toHaveLength(0);
  expect(host.textContent).toBe('');
});
