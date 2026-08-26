import { Link } from '@tanstack/react-router'
import { t, type Locale } from '@barghsa/i18n'

export interface WalletBalanceCardProps {
  /** Wallet balance in IRR (Rial). */
  balance: number
  /** Currency label, e.g. 'IRR'. */
  currency: string
  /** Whether balance is low relative to pending invoices. */
  lowBalanceWarning: boolean
  /** Number of pending invoices (for contextual warning). */
  pendingInvoices: number
  /** UI locale for number formatting and translation. */
  locale?: Locale
}

/**
 * Formats a number with locale-aware digit grouping.
 */
function formatAmount(amount: number, locale: Locale): string {
  try {
    return new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
      style: 'decimal',
    }).format(amount)
  } catch {
    return amount.toLocaleString()
  }
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
  const isRtl = locale === 'fa'
  const tomanAmount = Math.round(balance / 10)

  return (
    <div
      className="bg-white rounded-lg shadow-sm p-6"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {/* Balance section */}
      <div className="mb-4">
        <p className="text-sm text-gray-500 mb-1">
          {t('dashboard.overview.walletBalance', locale)}
        </p>
        <p className="text-3xl font-bold text-gray-900 leading-tight">
          {formatAmount(balance, locale)}{' '}
          <span className="text-lg font-medium text-gray-500">{currency}</span>
        </p>
        <p className="text-base text-gray-500 mt-1">
          {t('dashboard.overview.balanceInToman', locale).replace(
            '{amount}',
            formatAmount(tomanAmount, locale),
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
        className="block w-full text-center px-4 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark transition-colors"
      >
        {t('dashboard.overview.chargeWallet', locale)}
      </Link>
    </div>
  )
}