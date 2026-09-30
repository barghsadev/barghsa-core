import { expect, it } from 'vitest';
import { dateRangePreset } from './date-range-filter';

it('uses Gregorian or Jalali month boundaries in Tehran', () => {
  const now = new Date('2026-03-25T12:00:00Z');
  expect(dateRangePreset('thisMonth', 'fa', 'Asia/Tehran', now)).toEqual({
    from: '2026-03-20T20:30:00.000Z',
    to: '2026-04-20T20:30:00.000Z',
  });
  expect(dateRangePreset('lastMonth', 'fa', 'Asia/Tehran', now)).toEqual({
    from: '2026-02-19T20:30:00.000Z',
    to: '2026-03-20T20:30:00.000Z',
  });
  expect(dateRangePreset('thisMonth', 'en', 'Asia/Tehran', now)).toEqual({
    from: '2026-02-28T20:30:00.000Z',
    to: '2026-03-31T20:30:00.000Z',
  });
});

it('uses calendar days across daylight saving changes', () => {
  const now = new Date('2026-03-08T12:00:00Z');
  expect(dateRangePreset('today', 'en', 'America/New_York', now)).toEqual({
    from: '2026-03-08T05:00:00.000Z',
    to: '2026-03-09T04:00:00.000Z',
  });
  expect(dateRangePreset('last7', 'en', 'America/New_York', now)).toEqual({
    from: '2026-03-02T05:00:00.000Z',
    to: '2026-03-09T04:00:00.000Z',
  });
});

it('keeps account dates in an extreme timezone independent of the host', () => {
  expect(
    dateRangePreset('lastMonth', 'en', 'Pacific/Kiritimati', new Date('2026-03-25T12:00:00Z'))
  ).toEqual({
    from: '2026-01-31T10:00:00.000Z',
    to: '2026-02-28T10:00:00.000Z',
  });
});
