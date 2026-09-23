import { describe, expect, it } from 'vitest';
import {
  getCurrentJalaliMonthRange,
  getNextJalaliMonthRange,
  getCurrentWeekRange,
  getNextWeekRange,
  getWeekAfterNextRange,
  validateAdvancedPeriod,
} from './electricity-periods.js';

describe('Iran electricity periods', () => {
  it('starts remaining periods at now and uses the next Saturday boundary', () => {
    const now = new Date('2026-09-23T10:15:00.000Z');
    const current = getCurrentWeekRange(now);
    const next = getNextWeekRange(now);
    const afterNext = getWeekAfterNextRange(now);
    expect(current.start.toISOString()).toBe(now.toISOString());
    expect(current.end.toISOString()).toBe('2026-09-25T20:30:00.000Z');
    expect(next.start).toEqual(current.end);
    expect(next.end.toISOString()).toBe('2026-10-02T20:30:00.000Z');
    expect(afterNext.start).toEqual(next.end);
    expect(afterNext.end.toISOString()).toBe('2026-10-09T20:30:00.000Z');
  });

  it('uses the following Saturday even when now is already Saturday', () => {
    const current = getCurrentWeekRange(new Date('2026-09-25T21:00:00.000Z'));
    expect(current.end.toISOString()).toBe('2026-10-02T20:30:00.000Z');
  });

  it('crosses a leap-year 30-day Esfand and covers a full 31-day Farvardin', () => {
    const now = new Date('2025-03-18T12:00:00.000Z');
    const current = getCurrentJalaliMonthRange(now);
    const next = getNextJalaliMonthRange(now);
    expect(current.start).toEqual(now);
    expect(current.end.toISOString()).toBe('2025-03-20T20:30:00.000Z');
    expect(next.start).toEqual(current.end);
    expect(next.end.toISOString()).toBe('2025-04-20T20:30:00.000Z');
    expect((next.end.getTime() - next.start.getTime()) / 86_400_000).toBe(31);
  });

  it('crosses a regular 29-day Esfand and the following 31-day month', () => {
    const now = new Date('2026-02-22T10:00:00.000Z');
    const current = getCurrentJalaliMonthRange(now);
    const next = getNextJalaliMonthRange(now);
    expect(current.end.toISOString()).toBe('2026-03-20T20:30:00.000Z');
    expect((next.end.getTime() - next.start.getTime()) / 86_400_000).toBe(31);
  });

  it('uses 30 days for a regular Jalali autumn month', () => {
    const aban = getNextJalaliMonthRange(new Date('2025-09-24T12:00:00Z'));
    expect((aban.end.getTime() - aban.start.getTime()) / 86_400_000).toBe(30);
  });

  it('rejects invalid current instants', () => {
    expect(() => getCurrentWeekRange(new Date(NaN))).toThrow(RangeError);
  });

  it('enforces lead days and a Jalali-month maximum on custom hours', () => {
    const now = new Date('2026-03-20T12:00:00Z');
    const limits = { leadTimeDays: 1, maxContractDuration: 24 };
    expect(() =>
      validateAdvancedPeriod(
        new Date('2026-03-20T14:30:00Z'),
        new Date('2026-04-20T20:30:00Z'),
        now,
        limits
      )
    ).toThrow('allowed date');
    const start = new Date('2026-03-21T09:30:00Z');
    const end = new Date('2028-03-20T09:30:00Z');
    expect(validateAdvancedPeriod(start, end, now, limits)).toEqual({ start, end });
    expect(() =>
      validateAdvancedPeriod(start, new Date(end.getTime() + 60_000), now, limits)
    ).toThrow('maximum Jalali duration');
    expect(() => validateAdvancedPeriod(start, start, now, limits)).toThrow('after the start');
  });
});
