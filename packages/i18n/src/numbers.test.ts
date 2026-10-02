import { expect, it } from 'vitest';
import {
  exactIrr,
  formatCurrencyIrr,
  formatNumber,
  formatPercent,
  formatToman,
  type NumberStyle,
} from './numbers.js';

const plain = (value: string) =>
  value
    .replace(/[\u200e\u200f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
it('preserves rials above the safe-number range with a currency label', () => {
  expect(plain(formatCurrencyIrr('10000000000000001', 'en'))).toBe('IRR 10,000,000,000,000,001');
  expect(plain(formatCurrencyIrr(10000000000000001n, 'fa'))).toBe('ریال ۱۰٬۰۰۰٬۰۰۰٬۰۰۰٬۰۰۰٬۰۰۱');
  expect(exactIrr('-10000000000000001')).toBe(-10000000000000001n);
  expect(plain(formatCurrencyIrr(0, 'en'))).toBe('IRR 0');
});
it('changes numeral style without translating the currency label', () => {
  expect(plain(formatCurrencyIrr('123456', 'fa', { numberStyle: 'western' }))).toBe('ریال 123,456');
  expect(plain(formatCurrencyIrr('123456', 'en', { numberStyle: 'persian' }))).toBe('IRR ۱۲۳٬۴۵۶');
});
it('formats decimal separators and ratio percentages in the requested numerals', () => {
  expect(formatNumber(1234.5)).toBe('۱٬۲۳۴٫۵');
  expect(formatNumber(1234.5, 'fa', { numberStyle: 'western' })).toBe('1,234.5');
  expect(formatNumber(1234.5, 'en', { useGrouping: false, minimumFractionDigits: 2 })).toBe(
    '1234.50'
  );
  expect(formatPercent(0.075, 'en')).toBe('7.5%');
  expect(formatPercent(0.075, 'en', { numberStyle: 'persian' })).toBe('۷٫۵٪');
});
it.each(['', ' ', '1.5', '1e6', '۱۲۳', 'NaN', 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
  'rejects ambiguous or lossy rial input %s',
  (value) => {
    expect(() => formatCurrencyIrr(value)).toThrow(RangeError);
  }
);
it('rejects invalid numeric values and unrecognized preferences', () => {
  expect(() => formatNumber(NaN)).toThrow(RangeError);
  expect(() => formatNumber(Infinity)).toThrow(RangeError);
  expect(() => formatNumber(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  expect(() => formatNumber(1, 'en', { numberStyle: 'invalid' as NumberStyle })).toThrow(
    RangeError
  );
});

it.each([
  ['0', '0'],
  ['1', '0.1'],
  ['9', '0.9'],
  ['10', '1'],
  ['-1', '-0.1'],
  ['-19', '-1.9'],
  ['9007199254740993', '900,719,925,474,099.3'],
  ['-9223372036854775808', '-922,337,203,685,477,580.8'],
])('preserves exact toman equivalence for %s rials', (rials, expected) => {
  expect(plain(formatToman(rials, 'en'))).toBe(expected);
});
it('localizes exact toman digits without changing the UI language', () => {
  expect(plain(formatToman('1234567', 'fa'))).toBe('۱۲۳٬۴۵۶٫۷');
  expect(plain(formatToman('-1', 'fa'))).toBe('−۰٫۱');
  expect(plain(formatToman('1234567', 'fa', { numberStyle: 'western' }))).toBe('123,456.7');
  expect(plain(formatToman('1234567', 'en', { numberStyle: 'persian' }))).toBe('۱۲۳٬۴۵۶٫۷');
});
it.each(['1.5', '1e6', Number.MAX_SAFE_INTEGER + 1, NaN])(
  'rejects lossy toman conversion for %s',
  (amount) => expect(() => formatToman(amount, 'en')).toThrow(RangeError)
);
