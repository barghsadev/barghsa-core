import { expect, it } from 'vitest';
import { notificationDateGroups } from './notification-date-groups.js';
import { notificationItem } from '../test/notification-inbox-fixtures.js';

function item(id: string, date: string) {
  return { ...notificationItem(id), createdAt: date };
}
it('uses saved-zone calendar days across the spring DST transition and preserves order', () => {
  const now = Date.parse('2026-03-09T04:30:00Z'); // Monday,00:30 in New York
  const groups = notificationDateGroups(
    [
      item('today', '2026-03-09T04:05:00Z'),
      item('yesterday-one', '2026-03-08T07:30:00Z'),
      item('yesterday-two', '2026-03-08T06:30:00Z'),
      item('older', '2026-03-07T08:00:00Z'),
    ],
    'America/New_York',
    now,
    'en'
  );
  expect(
    groups.map((group) => [group.key, group.items.map((row) => row.localizedContent!.en!.title)])
  ).toEqual([
    ['today', ['today']],
    ['yesterday', ['yesterday-one', 'yesterday-two']],
    ['older', ['older']],
  ]);
});
it('uses the Persian Saturday and English Monday week boundaries without changing timestamps', () => {
  const now = Date.parse('2026-11-07T22:00:00Z'); // Sunday in Tehran
  const rows = [item('saturday', '2026-11-07T10:00:00Z'), item('friday', '2026-11-06T10:00:00Z')];
  expect(notificationDateGroups(rows, 'Asia/Tehran', now, 'fa').map((group) => group.key)).toEqual([
    'yesterday',
    'older',
  ]);
  expect(notificationDateGroups(rows, 'Asia/Tehran', now, 'en').map((group) => group.key)).toEqual([
    'yesterday',
    'week',
  ]);
  expect(rows[0]!.createdAt).toBe('2026-11-07T10:00:00Z');
});
