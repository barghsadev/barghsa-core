import { describe, expect, it } from 'vitest';
import { formatJalaliDateTime, parseJalaliDateTime } from './jalali-date-time.js';

describe('Jalali delivery date and time', () => {
  it('round-trips Iran local time across the new year', () => {
    const iso = '2026-03-20T20:30:00.000Z';
    const jalali = formatJalaliDateTime(new Date(iso));
    expect(jalali).toBe('1405-01-01T00:00');
    expect(parseJalaliDateTime(jalali)).toBe(iso);
  });

  it('rejects impossible dates and time values', () => {
    expect(parseJalaliDateTime('1404-12-30T12:00')).toBeNull();
    expect(parseJalaliDateTime('1405-01-01T24:00')).toBeNull();
  });
});
