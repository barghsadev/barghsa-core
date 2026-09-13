import { exactIrr } from '@barghsa/i18n/numbers';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { Link } from '@tanstack/react-router';
import { t, type Locale } from '@barghsa/i18n/app';

export interface WalletBalanceCardProps {
  /** Wallet balance in IRR (Rial). */
  balance: string | number;
  /** Currency label, e.g. 'IRR'. */
  currency: string;
  /** Whether balance is low relative to pending invoices. */
  lowBalanceWarning: boolean;
  /** Number of pending invoices (for contextual warning). */
  pendingInvoices: number;
  /** UI locale for number formatting and translation. */
  locale?: Locale;
}

/**
 * Wallet balance card (T-08.01.02).
 *
 * Shows the wallet balance prominently in IRR (Rial) and Toman, with a
 * "Charge wallet" button and a low-balance warning banner when applicable.
 */
export function WalletBalanceCard({
  balance,
  currency,
  lowBalanceWarning,
  pendingInvoices,
  locale = 'fa',
}: WalletBalanceCardProps) {
  const isRtl = locale === 'fa';
  const numbers = useNumberFormatting(locale);
  let exactBalance: bigint | null;
  try {
    exactBalance = exactIrr(balance);
  } catch {
    exactBalance = null;
  }
  const tomanAmount =
    exactBalance === null
      ? null
      : exactBalance >= 0n
        ? (exactBalance + 5n) / 10n
        : -((-exactBalance + 4n) / 10n);

  return (
    <div
      className="bg-card text-card-foreground rounded-lg shadow-sm p-6"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {/* Balance section */}
      <div className="mb-4">
        <p className="text-sm text-muted-foreground mb-1">
          {t('dashboard.overview.walletBalance', locale)}
        </p>
        <p className="text-3xl font-bold text-foreground leading-tight">
          {currency === 'IRR'
            ? numbers.money(balance)
            : `${numbers.irrDigits(balance)} ${currency}`}
        </p>
        <p className="text-base text-muted-foreground mt-1">
          {t('dashboard.overview.balanceInToman', locale).replace(
            '{amount}',
            tomanAmount === null ? '—' : numbers.irrDigits(tomanAmount)
          )}
        </p>
      </div>

      {/* Low-balance warning */}
      {lowBalanceWarning && pendingInvoices > 0 && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-sm text-yellow-800">
            {t('dashboard.overview.lowBalanceWarning', locale)}
          </p>
        </div>
      )}

      {/* Action button */}
      <Link
        to="/wallet"
        className="block w-full text-center px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary-dark transition-colors"
      >
        {t('dashboard.overview.chargeWallet', locale)}
      </Link>
    </div>
  );
}
