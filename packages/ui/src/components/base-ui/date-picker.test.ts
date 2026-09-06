import { describe, expect, it } from 'vitest';
import { datePickerAtTime, datePickerDayBounds } from './date-picker';

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
