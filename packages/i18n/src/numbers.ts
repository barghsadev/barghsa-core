import type { Locale } from './index.js';

export type NumberStyle = 'locale' | 'persian' | 'western';
export interface NumberOptions {
  numberStyle?: NumberStyle;
  useGrouping?: boolean;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

function options(locale: Locale, input: NumberOptions): Intl.NumberFormatOptions {
  if (locale !== 'fa' && locale !== 'en') throw new RangeError('Unsupported number locale');
  const style = input.numberStyle ?? 'locale';
  if (!['locale', 'persian', 'western'].includes(style))
    throw new RangeError('Unsupported number style');
  return {
    useGrouping: input.useGrouping ?? true,
    minimumFractionDigits: input.minimumFractionDigits,
    maximumFractionDigits: input.maximumFractionDigits,
    numberingSystem:
      style === 'persian' || (style === 'locale' && locale === 'fa') ? 'arabext' : 'latn',
  };
}

function checkedNumber(value: number | bigint): number | bigint {
  if (typeof value === 'bigint') return value;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (Number.isInteger(value) && !Number.isSafeInteger(value))
  ) {
    throw new RangeError('Number is invalid or has already lost integer precision');
  }
  return value;
}

/** Format a number without changing the surrounding UI language or direction. */
export function formatNumber(
  value: number | bigint,
  locale: Locale = 'fa',
  input: NumberOptions = {}
): string {
  return new Intl.NumberFormat(locale, options(locale, input)).format(checkedNumber(value));
}

/** Percent input is a ratio: 0.075 displays as 7.5%, or its Persian equivalent. */
export function formatPercent(
  value: number,
  locale: Locale = 'fa',
  input: NumberOptions = {}
): string {
  return new Intl.NumberFormat(locale, {
    ...options(locale, { maximumFractionDigits: 2, ...input }),
    style: 'percent',
  }).format(checkedNumber(value));
}

/** IRR is an integer amount. Decimal/exponent strings and unsafe JS integers are rejected. */
export function exactIrr(value: string | number | bigint): bigint {
  if (typeof value === 'string') {
    if (!/^-?\d+$/.test(value)) throw new RangeError('IRR must be an integer amount');
    return BigInt(value);
  }
  const checked = checkedNumber(value);
  if (typeof checked === 'number' && !Number.isInteger(checked))
    throw new RangeError('IRR must be an integer amount');
  return BigInt(checked);
}

/** Format whole rials with an explicit localized currency label, preserving arbitrary precision. */
export function formatCurrencyIrr(
  value: string | number | bigint,
  locale: Locale = 'fa',
  input: Pick<NumberOptions, 'numberStyle'> = {}
): string {
  return new Intl.NumberFormat(locale, {
    ...options(locale, input),
    style: 'currency',
    currency: 'IRR',
    currencyDisplay: locale === 'fa' ? 'symbol' : 'code',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(exactIrr(value));
}
