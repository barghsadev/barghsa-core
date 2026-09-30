import { expect, it } from 'vitest';
import { parseNumberRange, parseInvoiceListQuery } from './invoice-list-query.js';

it('keeps exact int8 amounts and normalizes both localized digit sets', () => {
  expect(parseNumberRange('۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۳', '٩٢٢٣٣٧٢٠٣٦٨٥٤٧٧٥٨٠٧')).toEqual({
    min: '9007199254740993',
    max: '9223372036854775807',
  });
  expect(parseNumberRange('0000', '')).toEqual({ min: '0', max: undefined });
  expect(parseNumberRange(undefined, undefined)).toEqual({ min: undefined, max: undefined });
  expect(parseNumberRange('', '0')).toEqual({ min: undefined, max: '0' });
});
it.each(['-1', '1.5', '1e3', '1,000', ' ', '9223372036854775808', '0'.repeat(33), ['1'], 10])(
  'rejects invalid amount %s',
  (value) => {
    expect(parseNumberRange(value, undefined)).toBeNull();
    expect(parseNumberRange(undefined, value)).toBeNull();
  }
);
it('rejects reversed ranges without rounding adjacent large integers', () => {
  expect(parseNumberRange('9007199254740993', '9007199254740992')).toBeNull();
  expect(parseNumberRange('9007199254740993', '9007199254740993')).not.toBeNull();
});
it('restricts sorting to creation time and shares bounded literal search validation', () => {
  expect(parseInvoiceListQuery(undefined, undefined)).toEqual({ q: '', sort: 'created_at:desc' });
  expect(parseInvoiceListQuery(' %_ ', 'created_at:asc')).toEqual({
    q: '%_',
    sort: 'created_at:asc',
  });
  for (const [q, sort] of [
    ['x'.repeat(121), undefined],
    ['\n', undefined],
    [['x'], undefined],
    ['', ['created_at:asc']],
    ['', 'submitted_at:asc'],
  ])
    expect(parseInvoiceListQuery(q, sort)).toBeNull();
});
