import { describe, expect, it } from 'vitest';
import { calendarInstant, calendarRelativeTime, createCalendar } from './calendar.js';

it('formats the same immutable instant in the selected calendar and account zone', () => {
  const date = new Date('2026-01-01T01:00:00Z');
  expect(createCalendar('en', 'America/New_York').format(date, 'yyyy/MM/dd HH:mm')).toBe(
    '2025/12/31 20:00'
  );
  expect(createCalendar('fa', 'Asia/Tehran').format(date, 'yyyy/MM/dd HH:mm')).toBe(
    '۱۴۰۴/۱۰/۱۱ ۰۴:۳۰'
  );
  expect(date.toISOString()).toBe('2026-01-01T01:00:00.000Z');
});

it('parses Persian and Arabic digits and rejects the invalid non-leap Esfand day', () => {
  const calendar = createCalendar('fa', 'Asia/Tehran');
  const reference = '2025-01-01T00:00:00Z';
  expect(calendar.parse('۱۴۰۳/۱۲/۳۰', 'yyyy/MM/dd', reference)?.toISOString()).toBe(
    '2025-03-19T20:30:00.000Z'
  );
  expect(calendar.parse('١٤٠٤/٠١/٠١', 'yyyy/MM/dd', reference)?.toISOString()).toBe(
    '2025-03-20T20:30:00.000Z'
  );
  expect(calendar.parse('۱۴۰۴/۱۲/۳۰', 'yyyy/MM/dd', reference)).toBeNull();
  expect(calendar.parse('۱۴۰۴/۱۳/۰۱', 'yyyy/MM/dd', reference)).toBeNull();
});

it('keeps civil time across DST day arithmetic and refuses nonexistent clock times', () => {
  const calendar = createCalendar('en', 'America/New_York');
  const before = new Date('2026-03-07T17:00:00Z');
  const after = calendar.addDays(before, 1);
  expect(after.toISOString()).toBe('2026-03-08T16:00:00.000Z');
  expect(after.getTime() - before.getTime()).toBe(23 * 60 * 60 * 1_000);
  expect(before.toISOString()).toBe('2026-03-07T17:00:00.000Z');
  expect(calendar.parse('2026/03/08 02:30', 'yyyy/MM/dd HH:mm', before)).toBeNull();
  expect(calendar.parse('2026/03/08 03:30', 'yyyy/MM/dd HH:mm', before)?.toISOString()).toBe(
    '2026-03-08T07:30:00.000Z'
  );
});

it('starts a Jalali month and crosses its year without using Gregorian month boundaries', () => {
  const calendar = createCalendar('fa', 'Asia/Tehran');
  const value = '2025-03-20T10:00:00Z';
  expect(calendar.format(calendar.startOfMonth(value), 'yyyy/MM/dd HH:mm')).toBe(
    '۱۴۰۳/۱۲/۰۱ ۰۰:۰۰'
  );
  expect(calendar.format(calendar.addDays(value, 1), 'yyyy/MM/dd')).toBe('۱۴۰۴/۰۱/۰۱');
  expect(calendar.format(calendar.addMonths(value, 1), 'yyyy/MM/dd')).toBe('۱۴۰۴/۰۱/۳۰');
});

it.each(['2026-01-01', '2026-01-01T00:00:00', 'badZ', NaN, Infinity])(
  'rejects ambiguous or invalid instants: %s',
  (value) => expect(() => calendarInstant(value)).toThrow(RangeError)
);
it('does not replace invalid zones or silently truncate calendar offsets', () => {
  expect(() => createCalendar('fa', 'Mars/Base')).toThrow(RangeError);
  expect(() => createCalendar().addDays('2026-01-01T00:00:00Z', 0.5)).toThrow(RangeError);
});

describe.each(['en', 'fa'] as const)('relative time in %s', (locale) => {
  it('covers recent, future and past instants', () => {
    const now = '2026-01-01T12:00:00Z';
    expect(calendarRelativeTime(now, locale, now)).toBe(
      locale === 'fa' ? 'لحظاتی پیش' : 'Just now'
    );
    expect(calendarRelativeTime('2026-01-01T12:00:15Z', locale, now)).toBe(
      locale === 'fa' ? 'لحظاتی دیگر' : 'In a few moments'
    );
    expect(calendarRelativeTime('2026-01-01T10:00:00Z', locale, now)).toBe(
      new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-2, 'hour')
    );
    expect(calendarRelativeTime('2026-01-04T12:00:00Z', locale, now)).toBe(
      new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(3, 'day')
    );
  });
});
