import { Wallet, Plus } from 'lucide-react';
import { Alert, AlertDescription, buttonVariants, cn } from '@barghsa/ui';
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
      className="flex h-full flex-col rounded-xl border bg-card p-6 text-card-foreground shadow-sm"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <Wallet className="mb-6 size-6 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />
      {/* Balance section */}
      <div className="mb-4">
        <p className="text-sm text-muted-foreground mb-1">
          {t('dashboard.overview.walletBalance', locale)}
        </p>
        <p className="break-words text-[clamp(1.5rem,2.5vw,2rem)] font-semibold text-foreground leading-relaxed tabular-nums">
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
        <Alert variant="warning" className="mb-4">
          <AlertDescription>{t('dashboard.overview.lowBalanceWarning', locale)}</AlertDescription>
        </Alert>
      )}

      {/* Action button */}
      <Link to="/wallet" className={cn(buttonVariants({ variant: 'default' }), 'mt-auto w-full')}>
        <Plus data-icon="inline-start" aria-hidden="true" />
        {t('dashboard.overview.chargeWallet', locale)}
      </Link>
    </div>
  );
}
