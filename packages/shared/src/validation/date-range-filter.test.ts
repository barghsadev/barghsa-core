import { expect, it } from 'vitest';
import { parseDateRangeFilter } from './date-range-filter.js';

it('accepts empty, one-sided and ordered half-open UTC ranges', () => {
  const from = '2026-09-01T00:00:00.000Z',
    to = '2026-10-01T00:00:00.000Z';
  expect(parseDateRangeFilter(undefined, undefined)).toEqual({ from: undefined, to: undefined });
  expect(parseDateRangeFilter(from, undefined)).toEqual({ from, to: undefined });
  expect(parseDateRangeFilter('', to)).toEqual({ from: undefined, to });
  expect(parseDateRangeFilter(from, to)).toEqual({ from, to });
  expect(parseDateRangeFilter(to, from)).toBeNull();
  expect(parseDateRangeFilter(from, from)).toBeNull();
});
it.each([
  '0000-01-01T00:00:00.000Z',
  '2026-02-30T00:00:00.000Z',
  '2026-09-01',
  '2026-09-01T00:00:00Z',
  '2026-09-01T00:00:00.000+03:30',
  [],
  null,
  1,
  'x'.repeat(500),
])('rejects malformed UTC bound %s', (value) => {
  expect(parseDateRangeFilter(value, undefined)).toBeNull();
  expect(parseDateRangeFilter(undefined, value)).toBeNull();
});
