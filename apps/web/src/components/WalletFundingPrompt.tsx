import { t } from '@barghsa/i18n/workspace';
import { buttonVariants } from '@barghsa/ui';
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
      {!staff && returnInvoiceId ? (
        <div className="flex flex-wrap gap-2">
          <a
            className={buttonVariants({ size: 'sm' })}
            href={`/wallet/top-up/online?returnInvoiceId=${encodeURIComponent(returnInvoiceId)}`}
          >
            {t('wallet.page.onlineTitle', locale)}
          </a>
          <a
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            href={`/wallet/top-up/bank-receipt?returnInvoiceId=${encodeURIComponent(returnInvoiceId)}`}
          >
            {t('wallet.page.receiptTitle', locale)}
          </a>
        </div>
      ) : (
        <>
          <p>{t(staff ? 'wallet.funding.customerMethods' : 'wallet.funding.methods', locale)}</p>
          {!staff && (
            <a className="font-medium underline" href="/wallet">
              {t('wallet.funding.open', locale)}
            </a>
          )}
        </>
      )}
    </div>
  );
}
