import { lazy, Suspense, useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { CreditCard, ReceiptText } from 'lucide-react';
import { Button, PageLoading, Skeleton, buttonVariants } from '@barghsa/ui';
import { t } from '@barghsa/i18n/workspace';
import { loadingText } from '@barghsa/i18n/loading-feedback';
import { Currency } from '../components/Currency.js';
import { MaintenanceNotice } from '../components/MaintenanceNotice.js';
import { TransactionList } from '../components/WalletTransactionList.js';
import type { WalletPaymentReturn } from '../components/OnlinePaymentReturnPanel.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { useLocale } from '../hooks/useLocale.js';
import { useMaintenance } from '../hooks/useMaintenance.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useWalletBalance } from '../hooks/useWalletBalance.js';
import { fetchInvoiceDetails } from '../lib/customer-invoices.js';
import { getProfileContextRevision, useProfileContextRevision } from '../lib/profile-context.js';

const PaymentReturn = lazy(() =>
  import('../components/OnlinePaymentReturnPanel.js').then(({ OnlinePaymentReturnPanel }) => ({
    default: OnlinePaymentReturnPanel,
  }))
);

interface WalletOverviewProps {
  paymentReturn: WalletPaymentReturn | undefined;
  returnInvoiceId: string | undefined;
  history: ListQueryBinding;
  backSearch: Record<string, unknown>;
}

export default function WalletOverviewPage(props: WalletOverviewProps) {
  const actor = useAccountUser();
  const profileRevision = useProfileContextRevision();
  return <WalletOverview key={JSON.stringify([actor, profileRevision])} {...props} />;
}

function WalletOverview({
  paymentReturn,
  returnInvoiceId,
  history,
  backSearch,
}: WalletOverviewProps) {
  const locale = useLocale();
  const maintenance = useMaintenance('wallet_topup');
  const numbers = useNumberFormatting(locale);
  const revision = useProfileContextRevision();
  const { wallet, profileId, loading, error, load } = useWalletBalance();
  const [invoice, setInvoice] = useState<{
    id: string;
    profileId: string;
    due: bigint;
  } | null>(null);
  useEffect(() => {
    if (!returnInvoiceId || !profileId) return;
    const controller = new AbortController();
    void fetchInvoiceDetails(returnInvoiceId, controller.signal)
      .then(({ invoice: record }) => {
        if (controller.signal.aborted || getProfileContextRevision() !== revision) return;
        const payable = ['Unpaid', 'Overdue', 'PartiallyFunded'].includes(record.state);
        setInvoice({
          id: returnInvoiceId,
          profileId,
          due: payable ? BigInt(record.totalAmount) - BigInt(record.paidAmount) : 0n,
        });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [returnInvoiceId, profileId, revision]);

  const word = (key: string) => t(`wallet.page.${key}`, locale);
  const missing =
    wallet?.currency === 'IRR' &&
    invoice &&
    invoice.id === returnInvoiceId &&
    invoice.profileId === profileId
      ? invoice.due - BigInt(wallet.balance)
      : 0n;
  const reviewLoading = <PageLoading label={word('reviewLoading')} />;
  return (
    <div
      className="mx-auto max-w-5xl space-y-5"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
      data-testid="wallet-page"
    >
      <h1 className="text-2xl font-semibold sm:text-3xl">{word('title')}</h1>
      {returnInvoiceId && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/25 bg-accent p-4">
          <Link
            to="/invoices/$invoiceId"
            params={{ invoiceId: returnInvoiceId }}
            className="touch-action text-sm font-medium text-primary underline underline-offset-4"
          >
            {word('returnToInvoice')}
          </Link>
          {missing > 0n && (
            <p className="text-sm tabular-nums">
              {t('wallet.funding.shortfall', locale)} · <strong>{numbers.money(missing)}</strong>
            </p>
          )}
        </section>
      )}
      {loading ? (
        <div role="status" aria-label={loadingText('loading', locale)}>
          <Skeleton className="h-36 rounded-xl" data-testid="wallet-loading" />
        </div>
      ) : (
        <div className="space-y-5" data-testid="wallet-loaded">
          {wallet && (
            <section className="flex flex-col gap-5 rounded-xl border bg-card p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
              <div>
                <h2 className="text-sm font-medium text-muted-foreground">
                  {word('availableBalance')}
                </h2>
                <p
                  className="mt-1 text-3xl font-semibold tabular-nums"
                  data-testid="wallet-balance"
                >
                  {wallet.currency === 'IRR' ? (
                    <Currency amount={wallet.balance} showToman variant="large" locale={locale} />
                  ) : (
                    <bdi>
                      {numbers.irrDigits(wallet.balance)} {wallet.currency}
                    </bdi>
                  )}
                </p>
              </div>
              {!maintenance?.active && (
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to="/wallet/top-up/$method"
                    params={{ method: 'online' }}
                    search={backSearch}
                    className={buttonVariants({ className: 'min-h-11' })}
                  >
                    <CreditCard size={16} aria-hidden="true" />
                    {word('onlineTitle')}
                  </Link>
                  <Link
                    to="/wallet/top-up/$method"
                    params={{ method: 'bank-receipt' }}
                    search={backSearch}
                    className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
                  >
                    <ReceiptText size={16} aria-hidden="true" />
                    {word('receiptTitle')}
                  </Link>
                </div>
              )}
            </section>
          )}
          {error && (
            <div
              className="space-y-2 rounded-lg border border-destructive/20 bg-danger-soft p-4 text-sm text-destructive"
              data-testid="wallet-error"
            >
              <p role="alert">{word(error === 'no-profile' ? 'noProfile' : 'loadError')}</p>
              {error !== 'no-profile' && (
                <Button variant="outline" onClick={() => void load()}>
                  {word('retry')}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      {paymentReturn && (
        <Suspense fallback={reviewLoading}>
          <PaymentReturn
            key={`${paymentReturn.orderId}:${paymentReturn.authority}`}
            payment={paymentReturn}
            locale={locale}
            onConfirmed={() => void load()}
          />
        </Suspense>
      )}
      {maintenance?.active && <MaintenanceNotice setting={maintenance} />}
      {profileId && !loading && (
        <TransactionList profileId={profileId} locale={locale} binding={history} />
      )}
    </div>
  );
}
