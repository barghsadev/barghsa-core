import { useMemo } from 'react';
import type { Locale } from '@barghsa/i18n/app';
import {
  exactIrr,
  formatCurrencyIrr,
  formatNumber,
  formatPercent,
  type NumberOptions,
} from '@barghsa/i18n/numbers';
import { useBrandConfig } from '../providers/BrandThemeProvider.js';

type DisplayOptions = Omit<NumberOptions, 'numberStyle'>;
const display = (format: () => string) => {
  try {
    return format();
  } catch {
    return '—';
  }
};

/** Published numeral preferences affect display only, never submitted values. */
export function useNumberFormatting(locale: Locale) {
  const { brandConfig } = useBrandConfig();
  const numberStyle = brandConfig.numberStyle;
  return useMemo(
    () => ({
      numberStyle,
      number: (value: number | bigint, options: DisplayOptions = {}) =>
        display(() => formatNumber(value, locale, { ...options, numberStyle })),
      percent: (value: number, options: DisplayOptions = {}) =>
        display(() => formatPercent(value, locale, { ...options, numberStyle })),
      irrDigits: (value: string | number | bigint) =>
        display(() => formatNumber(exactIrr(value), locale, { numberStyle })),
      money: (value: string | number | bigint) =>
        display(() => formatCurrencyIrr(value, locale, { numberStyle })),
    }),
    [locale, numberStyle]
  );
}
