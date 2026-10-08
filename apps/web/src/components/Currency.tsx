import { cn } from '@barghsa/ui';
import { t, type Locale } from '@barghsa/i18n/workspace';
import { exactIrr, formatToman } from '@barghsa/i18n/numbers';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

export interface CurrencyProps {
  amount: string | number | bigint;
  showToman?: boolean;
  /** Omit for the localized label; true shows an IRR suffix, false shows digits only. */
  showCurrencyCode?: boolean;
  variant?: 'default' | 'large' | 'small';
  locale?: Locale;
  className?: string;
}

/** Whole rials and optional exact toman equivalence; preferences affect display only. */
export function Currency({
  amount,
  showToman = false,
  showCurrencyCode,
  variant = 'default',
  locale: preferredLocale,
  className,
}: CurrencyProps) {
  const currentLocale = useLocale();
  const locale = preferredLocale ?? currentLocale;
  const numbers = useNumberFormatting(locale);
  let rials: bigint | null = null;
  try {
    rials = exactIrr(amount);
  } catch {
    // Never display a rounded, ambiguous or invalid monetary input as a valid balance.
  }
  const longAmount = rials !== null && (rials < 0n ? -rials : rials).toString().length > 12;
  return (
    <span
      data-slot="currency"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
      className={cn(
        'tabular-nums break-words [overflow-wrap:anywhere]',
        variant === 'large' &&
          'block [container-type:inline-size] text-[clamp(1.5rem,2.5vw,2rem)] font-semibold leading-relaxed',
        variant === 'small' && 'text-sm',
        className
      )}
    >
      <bdi
        className={cn(
          variant === 'large' && 'block',
          variant === 'large' && longAmount && 'text-[clamp(0.875rem,5.5cqw,1.25rem)]'
        )}
      >
        {rials === null
          ? '—'
          : showCurrencyCode === false
            ? numbers.irrDigits(rials)
            : showCurrencyCode === true
              ? `${numbers.irrDigits(rials)} IRR`
              : numbers.money(rials)}
      </bdi>
      {showToman && rials !== null ? (
        <span
          className={cn(
            'text-sm font-normal text-muted-foreground',
            variant === 'large' && 'mt-1 block'
          )}
        >
          {' '}
          (<bdi>{formatToman(rials, locale, { numberStyle: numbers.numberStyle })}</bdi>{' '}
          {t('currency.toman', locale)})
        </span>
      ) : null}
    </span>
  );
}
