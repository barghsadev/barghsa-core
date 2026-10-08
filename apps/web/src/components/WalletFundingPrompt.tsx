import { t } from '@barghsa/i18n/workspace';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

export function WalletFundingPrompt({
  balance,
  total,
  returnInvoiceId,
  staff = false,
}: {
  balance: string | null;
  total: string;
  returnInvoiceId?: string;
  staff?: boolean;
}) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  let shortfall: bigint | null = null;
  try {
    if (balance !== null) {
      const difference = BigInt(total) - BigInt(balance);
      if (difference <= 0n) return null;
      shortfall = difference;
    }
  } catch {
    shortfall = null;
  }
  return (
    <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
      <p role="status">
        {shortfall === null
          ? t('wallet.funding.unknown', locale)
          : `${t('wallet.funding.shortfall', locale)}: ${numbers.money(shortfall.toString())}`}
      </p>
      <p>{t(staff ? 'wallet.funding.customerMethods' : 'wallet.funding.methods', locale)}</p>
      {!staff && (
        <a
          className="font-medium underline"
          href={
            returnInvoiceId
              ? `/wallet?returnInvoiceId=${encodeURIComponent(returnInvoiceId)}`
              : '/wallet'
          }
        >
          {t('wallet.funding.open', locale)}
        </a>
      )}
    </div>
  );
}
