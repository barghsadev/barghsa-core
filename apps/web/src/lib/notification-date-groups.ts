import type { NotificationItem } from './notifications.js';

export type NotificationDateGroup = 'today' | 'yesterday' | 'week' | 'older';
const dayMs = 86_400_000;

/** Calendar days in the saved time zone, including DST transitions; never elapsed 24h buckets. */
export function notificationDateGroups(
  items: NotificationItem[],
  timeZone: string,
  now: number,
  locale: 'en' | 'fa'
): { key: NotificationDateGroup; items: NotificationItem[] }[] {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  const day = (value: number) => {
    const parts = format.formatToParts(value);
    const n = (kind: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === kind)!.value);
    return Date.UTC(n('year'), n('month') - 1, n('day'));
  };
  const today = day(now);
  const weekStart = locale === 'fa' ? 6 : 1;
  const week = today - ((new Date(today).getUTCDay() - weekStart + 7) % 7) * dayMs;
  const groups: Record<NotificationDateGroup, NotificationItem[]> = {
    today: [],
    yesterday: [],
    week: [],
    older: [],
  };
  for (const item of items) {
    const created = day(Date.parse(item.createdAt));
    groups[
      created >= today
        ? 'today'
        : created === today - dayMs
          ? 'yesterday'
          : created >= week
            ? 'week'
            : 'older'
    ].push(item);
  }
  return (Object.keys(groups) as NotificationDateGroup[])
    .filter((key) => groups[key].length)
    .map((key) => ({ key, items: groups[key] }));
}
