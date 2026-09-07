import { expect, it } from 'vitest';
import {
  exactIrr,
  formatCurrencyIrr,
  formatNumber,
  formatPercent,
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
