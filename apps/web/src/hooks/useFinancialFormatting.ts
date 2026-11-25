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
        const toman = formatToman(value, locale, { numberStyle: numbers.numberStyle });
        return `${numbers.money(value)} · ${toman}\u00a0${confirmationText('toman', locale)}`;
      } catch {
        return '—';
      }
    },
  };
}
