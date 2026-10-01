import { expect, it } from 'vitest';
import { notificationInboxCursor, notificationInboxSearch } from './notification-inbox-query.js';
import { notificationCursor } from '../test/notification-inbox-fixtures.js';
it('preserves the exact microsecond boundary and only public inbox state', () => {
  const cursor = notificationCursor();
  expect(
    notificationInboxSearch({
      filter: 'unread',
      cursor,
      q: 'private',
      password: 'private',
      title: 'private',
    })
  ).toEqual({ filter: 'unread', cursor });
  expect(atob(notificationInboxCursor(cursor))).toContain('.123456Z|');
});
it.each([undefined, null, {}, [], 'ALL', ' unread', 'other'])(
  'defaults invalid inbox filters %j',
  (filter) => {
    expect(notificationInboxSearch({ filter }).filter).toBeUndefined();
  }
);
it.each([
  null,
  [],
  {},
  'private',
  'a'.repeat(2001),
  notificationCursor() + '=',
  notificationCursor() + ' ',
  btoa('secret|private'),
  notificationCursor('invalid'),
  notificationCursor('2026-10-01T00:00:00Z', 'private'),
  btoa('2026-10-01T00:00:00Z|10000000-0000-4000-8000-000000000001|extra'),
])('refuses malformed cursor %j', (value) => {
  expect(notificationInboxCursor(value)).toBe('');
});
it.each(['2026-10-01T00:00:00Z', '2026-10-01T00:00:00.123Z', '2026-10-01T00:00:00.123456Z'])(
  'keeps supported cursor instant %s exact',
  (date) => {
    const cursor = notificationCursor(date);
    expect(notificationInboxCursor(cursor)).toBe(cursor);
  }
);
