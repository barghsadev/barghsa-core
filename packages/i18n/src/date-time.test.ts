import { expect, it } from 'vitest';
import { formatDate, formatTime, formatInTimezone } from './date-time.js';
import { brandingText } from './branding.js';

it('uses the account timezone across midnight instead of the host timezone', () => {
  const instant = '2026-01-01T01:00:00Z';
  expect(formatDate(instant, 'America/Los_Angeles', 'en')).toBe('12/31/2025');
  expect(formatDate(instant, 'Asia/Tehran', 'en')).toBe('01/01/2026');
  expect(formatDate(instant, 'Asia/Tehran', 'fa')).toBe('۱۴۰۴/۱۰/۱۱');
  expect(formatTime(instant, 'Asia/Tehran', 'en')).toBe('4:30 AM');
});
it('handles spring DST gaps and repeated autumn hours as UTC instants', () => {
  expect(formatTime('2026-03-08T06:30:00Z', 'America/New_York')).toBe('1:30 AM');
  expect(formatTime('2026-03-08T07:30:00Z', 'America/New_York')).toBe('3:30 AM');
  expect(formatTime('2026-11-01T05:30:00Z', 'America/New_York')).toBe('1:30 AM');
  expect(formatTime('2026-11-01T06:30:00Z', 'America/New_York')).toBe('1:30 AM');
});
it('accepts explicit offsets, dates and milliseconds with a deliberate default timezone', () => {
  const instant = '2026-01-01T03:30:00+03:30';
  expect(formatTime(instant)).toBe('3:30 AM');
  expect(formatTime(new Date(instant))).toBe('3:30 AM');
  expect(formatTime(Date.parse(instant))).toBe('3:30 AM');
  expect(
    formatInTimezone(instant, 'Asia/Tehran', 'en', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: 'UTC',
    })
  ).toBe('03:30');
});
it.each(['2026-01-01', '2026-01-01T00:00:00', 'not-a-date', NaN, Infinity])(
  'rejects invalid or timezone-ambiguous input %s',
  (value) => {
    expect(() => formatDate(value)).toThrow(RangeError);
  }
);
it('does not silently replace an invalid account timezone', () => {
  expect(() => formatDate('2026-01-01T00:00:00Z', 'Mars/Base')).toThrow(RangeError);
});
it('keeps branding upload and action messages in the selected language', () => {
  for (const key of ['uploadFailed', 'uploading', 'save', 'activate', 'timezoneFailed'] as const) {
    expect(brandingText(key, 'fa')).toMatch(/[\u0600-\u06ff]/);
    expect(brandingText(key, 'en')).not.toMatch(/[\u0600-\u06ff]/);
  }
});
