import { afterEach, expect, it, vi } from 'vitest';
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllRead,
  markOneRead,
  NotificationApiError,
  isNotificationDenied,
} from './notifications.js';
import {
  notificationItem as item,
  notificationPage as page,
} from '../test/notification-inbox-fixtures.js';
afterEach(() => vi.unstubAllGlobals());
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const calls = [fetchUnreadCount, markAllRead, () => markOneRead(item().id)];
for (const [index, read] of calls.entries()) {
  it.each([
    {},
    { unread_count: -1 },
    { unread_count: '2' },
    { unread_count: 0.5 },
    { unread_count: null },
  ])(`count endpoint ${index} rejects malformed receipts: %j`, async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(body)));
    await expect(read()).rejects.toThrow();
  });
  it.each([401, 403])(
    `count endpoint ${index} exposes only a typed denied status: %i`,
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(reply({ secret: 'must stay private' }, status))
      );
      await expect(read()).rejects.toBeInstanceOf(NotificationApiError);
      try {
        await read();
      } catch (error) {
        expect(isNotificationDenied(error)).toBe(true);
        expect(String(error)).not.toContain('secret');
      }
    }
  );
}
it.each([
  {},
  { ...page(), data: [item(), item()] },
  { ...page(), unread_count: -1 },
  { ...page(), next_cursor: '' },
  { ...page(), data: [{ ...item(), params: null }] },
  { ...page(), data: [{ ...item(), createdAt: 'invalid' }] },
  { ...page(), data: [{ ...item(), localizedContent: { en: { title: 'Title', body: [] } } }] },
  { ...page(), data: [{ ...item(), isRead: 'false' }] },
  { ...page(), data: [{ ...item(), id: '../not-an-id' }] },
])('malformed pages cannot replace accepted notification state: %j', async (body) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(body)));
  await expect(fetchNotifications()).rejects.toThrow();
});
it('rejects read rows in the unread filter and oversized pages', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(reply({ ...page(), data: [{ ...item(), isRead: true }] }))
  );
  await expect(fetchNotifications(undefined, 'unread')).rejects.toThrow();
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        reply({ ...page(), data: [item(), item('Second', '10000000-0000-4000-8000-000000000002')] })
      )
  );
  await expect(fetchNotifications(undefined, 'all', 1)).rejects.toThrow();
});
it('preserves opaque cursor and supported filter requests', async () => {
  const fetch = vi.fn().mockResolvedValue(reply(page()));
  vi.stubGlobal('fetch', fetch);
  await expect(fetchNotifications('opaque+/=', 'unread', 20)).resolves.toEqual(page());
  expect(String(fetch.mock.calls[0]![0])).toContain('cursor=opaque%2B%2F%3D');
});
