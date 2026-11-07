import { useNumberFormatting } from './useNumberFormatting.js';
import { formatToman } from '@barghsa/i18n/numbers';
import { confirmationText } from '@barghsa/i18n/confirmation';
import type { Locale } from '@barghsa/i18n/app';

/** Display-only conversion. Submitted amounts and authoritative review hashes stay in IRR. */
export function useFinancialFormatting(locale: Locale) {
  const numbers = useNumberFormatting(locale);
  return {
    ...numbers,
    reviewMoney: (value: string | number | bigint) => {
      try {
        return `${numbers.money(value)} · ${formatToman(value, locale, { numberStyle: numbers.numberStyle })} ${confirmationText('toman', locale)}`;
      } catch {
        return '—';
      }
    },
  };
}
