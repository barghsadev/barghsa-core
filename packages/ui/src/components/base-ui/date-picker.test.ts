import { describe, expect, it } from 'vitest';
import { datePickerAtTime, datePickerDayBounds, datePickerCalendarDate } from './date-picker';

describe('account calendar timestamps', () => {
  it('resolves the Tehran day independently of the host zone', () => {
    expect(
      datePickerAtTime(new Date('2026-03-20T21:00:00Z'), 10, 15, 'Asia/Tehran')?.toISOString()
    ).toBe('2026-03-21T06:45:00.000Z');
  });
  it('rejects skipped New York wall-clock time and invalid inputs', () => {
    const day = new Date('2026-03-08T12:00:00Z');
    expect(datePickerAtTime(day, 2, 30, 'America/New_York')).toBeUndefined();
    expect(datePickerAtTime(day, 3, 30, 'America/New_York')?.toISOString()).toBe(
      '2026-03-08T07:30:00.000Z'
    );
    expect(datePickerAtTime(day, 24, 0, 'UTC')).toBeUndefined();
    expect(datePickerAtTime(day, 12, -1, 'UTC')).toBeUndefined();
  });
  it('uses calendar-day endpoints across the fall DST change', () => {
    const { start, end } = datePickerDayBounds(
      new Date('2026-11-01T12:00:00Z'),
      'America/New_York'
    );
    expect(start.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-02T04:59:59.999Z');
  });
});

it('constructs date-only filters in extreme zones and rejects invalid dates', () => {
  expect(datePickerCalendarDate('2026-03-21', 'Pacific/Kiritimati')?.toISOString()).toBe(
    '2026-03-21T12:00:00.000+14:00'
  );
  const selected = datePickerCalendarDate('2026-03-21', 'Pacific/Kiritimati')!;
  expect(datePickerDayBounds(selected, 'Pacific/Kiritimati').start.toISOString()).toBe(
    '2026-03-20T10:00:00.000Z'
  );
  expect(datePickerCalendarDate('2026-02-30', 'UTC')).toBeUndefined();
  expect(datePickerCalendarDate('2026-13-01', 'UTC')).toBeUndefined();
});

it.each([
  '2026-2-01',
  '2026-02-1',
  '2026-02-01T00:00:00Z',
  '',
  'not-a-date',
  '2026-02-29',
  '1900-02-29',
  '2026-00-01',
  '2026-01-00',
  '2026-04-31',
])('rejects malformed or nonexistent date-only filter %s', (value) => {
  expect(datePickerCalendarDate(value, 'UTC')).toBeUndefined();
});

it.each(['2024-02-29', '2000-02-29'])('accepts Gregorian leap day %s', (value) => {
  const date = datePickerCalendarDate(value, 'UTC')!;
  expect(new Date(date.getTime()).toISOString()).toBe(`${value}T12:00:00.000Z`);
});

it('uses a 23-hour interval on the spring DST transition', () => {
  const { start, end } = datePickerDayBounds(new Date('2026-03-08T12:00:00Z'), 'America/New_York');
  expect(start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
  expect(end.toISOString()).toBe('2026-03-09T03:59:59.999Z');
  expect(end.getTime() - start.getTime() + 1).toBe(23 * 60 * 60 * 1000);
});

it.each([
  [-1, 0],
  [24, 0],
  [1.5, 0],
  [NaN, 0],
  [Infinity, 0],
  [0, -1],
  [0, 60],
  [0, 0.5],
  [0, NaN],
  [0, Infinity],
])('rejects invalid wall-clock fields %s:%s', (hours, minutes) => {
  expect(datePickerAtTime(new Date('2026-03-21T12:00:00Z'), hours, minutes, 'UTC')).toBeUndefined();
});

it('accepts midnight and the last minute without changing the input date', () => {
  const date = new Date('2026-03-21T12:00:00Z');
  expect(datePickerAtTime(date, 0, 0, 'Asia/Tehran')?.toISOString()).toBe(
    '2026-03-20T20:30:00.000Z'
  );
  expect(datePickerAtTime(date, 23, 59, 'Asia/Tehran')?.toISOString()).toBe(
    '2026-03-21T20:29:00.000Z'
  );
  expect(date.toISOString()).toBe('2026-03-21T12:00:00.000Z');
});
