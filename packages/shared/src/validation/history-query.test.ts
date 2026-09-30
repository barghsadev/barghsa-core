import { expect, it } from 'vitest';
import { parseHistoryQuery, literalSearchPattern, DEFAULT_HISTORY_SORT } from './history-query.js';

it('normalizes search text and applies only the allowed sort choices', () => {
  expect(parseHistoryQuery(undefined, undefined)).toEqual({ q: '', sort: DEFAULT_HISTORY_SORT });
  expect(parseHistoryQuery('  قبض 123  ', 'submitted_at:asc')).toEqual({
    q: 'قبض 123',
    sort: 'submitted_at:asc',
  });
  expect(parseHistoryQuery('', '')).toEqual({ q: '', sort: DEFAULT_HISTORY_SORT });
});
it.each([
  ['x'.repeat(121), undefined],
  [[], undefined],
  [null, undefined],
  ['x\0y', undefined],
  ['\n', undefined],
  ['', 'status:asc'],
  ['', 'submitted_at;DROP'],
  ['', []],
])('rejects malformed history query %s / %s', (q, sort) => {
  expect(parseHistoryQuery(q, sort)).toBeNull();
});
it('escapes LIKE wildcards and leaves multilingual text intact', () => {
  expect(literalSearchPattern('')).toBeNull();
  expect(literalSearchPattern('100%_\\طرح')).toBe('%100\\%\\_\\\\طرح%');
});
