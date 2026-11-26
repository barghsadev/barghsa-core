import { useCommandFeedback } from '../hooks/useCommandFeedback.js';
import { useOwnedFinancialRead } from '../hooks/useOwnedFinancialRead.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { LoadingStatus, Alert, AlertDescription, Button, ListRefreshButton } from '@barghsa/ui';
import { CircleCheckIcon, WalletIcon } from 'lucide-react';
import { tWalletInvoicePayment as t } from '@barghsa/i18n/wallet-invoice-payment';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { isInvoiceUuid } from '../lib/due-at-override.js';
import { parseWalletPaymentReview, type WalletPaymentReview } from '@barghsa/shared/finance';
import { WalletPaymentReviewSummary } from './WalletPaymentReviewSummary.js';
import { WalletFundingPrompt } from './WalletFundingPrompt.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { RecordEditorActions, recordEditorSurface } from './RecordEditorLayout.js';
import './wallet-invoice-payment.css';
const TeamActionDialog = lazy(() =>
  import('./TeamActionDialog.js').then((module) => ({ default: module.TeamActionDialog }))
);

type Quote = {
  invoiceId: string;
  profileId: string;
  remainingAmount: string;
  availableBalance: string;
  canPay: boolean;
  review: WalletPaymentReview;
};
type Intent = Quote & { idempotencyKey: string };
function quoteFrom(value: unknown, invoiceId: string): Quote {
  const q = value as Partial<Quote> | null;
  const review = parseWalletPaymentReview(q?.review);
  if (
    !q ||
    !review ||
    review.scope.resourceId !== invoiceId ||
    review.scope.profileId !== q.profileId ||
    review.data.invoice.remainingAmount !== q.remainingAmount ||
    review.data.payment.availableBefore !== q.availableBalance ||
    q.invoiceId !== invoiceId ||
    typeof q.profileId !== 'string' ||
    !isInvoiceUuid(q.profileId) ||
    typeof q.remainingAmount !== 'string' ||
    !/^\d{1,19}$/.test(q.remainingAmount) ||
    BigInt(q.remainingAmount) > 9_223_372_036_854_775_807n ||
    typeof q.availableBalance !== 'string' ||
    !/^-?\d{1,20}$/.test(q.availableBalance) ||
    typeof q.canPay !== 'boolean' ||
    (q.canPay &&
      (BigInt(q.remainingAmount) <= 0n || BigInt(q.availableBalance) < BigInt(q.remainingAmount)))
  )
    throw new Error('Invalid payment review');
  return { ...q, review } as Quote;
}

export function WalletInvoicePaymentPanel(
  props: Parameters<typeof OwnedWalletInvoicePaymentPanel>[0]
) {
  const actor = useAccountUser();
  const profileRevision = useProfileContextRevision();
  return (
    <OwnedWalletInvoicePaymentPanel
      key={JSON.stringify([actor, profileRevision, props.invoiceId])}
      {...props}
    />
  );
}
function OwnedWalletInvoicePaymentPanel({
  invoiceId,
  eligible,
  onRefreshDetails,
}: {
  invoiceId: string;
  eligible: boolean;
  onRefreshDetails: () => Promise<void>;
}) {
  const actor = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const readFinancial = useOwnedFinancialRead(
    actor,
    profileRevision,
    JSON.stringify([invoiceId, eligible])
  );
  const locale = useLocale(),
    numbers = useNumberFormatting(locale);
  const time = useAccountTime(locale);
  const text = (key: Parameters<typeof t>[0]) => t(key, locale);
  const paymentButton = useRef<HTMLButtonElement>(null);
  const receiptHeading = useRef<HTMLHeadingElement>(null);
  const [quote, setQuote] = useState<Quote | null>(null),
    [intent, setIntent] = useState<Intent | null>(null);
  const [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [hidden, setHidden] = useState(false),
    [open, setOpen] = useState(false),
    [unconfirmed, setUnconfirmed] = useState(false);
  const [result, setResult] = useState<{ amount: string; transactionId: string } | null>(null),
    [refreshError, setRefreshError] = useState(false);
  useCommandFeedback({ success: result ? text('paid') : null, operation: invoiceId });
  const dialogAmount = intent ? numbers.money(intent.remainingAmount) : '';
  const paymentAction = useMemo(
    () =>
      intent
        ? {
            title: t('confirm', locale),
            description: t('description', locale).replace('{amount}', dialogAmount),
            path: `/api/invoices/${intent.invoiceId}/wallet-payment`,
            method: 'POST' as const,
            body: {
              idempotencyKey: intent.idempotencyKey,
              expectedRemainingAmount: intent.remainingAmount,
              expectedReviewHash: intent.review.hash,
            },
            conflictMessage: t('conflict', locale),
            forbiddenMessage: t('denied', locale),
          }
        : null,
    [intent, locale, dialogAmount]
  );
  useEffect(() => {
    if (!eligible) {
      setLoading(false);
      return;
    }
    const abort = new AbortController();
    setLoading(true);
    setQuote(null);
    setError(false);
    setHidden(false);
    void readFinancial(`/api/invoices/${invoiceId}/wallet-payment`, { signal: abort.signal })
      .then(async (response) => {
        if (response.status === 403 || response.status === 404) {
          if (!abort.signal.aborted) setHidden(true);
          return;
        }
        if (!response.ok) throw new Error('Payment review failed');
        const next = quoteFrom(await response.json(), invoiceId);
        if (!abort.signal.aborted) {
          setQuote(next);
          setIntent((previous) =>
            previous &&
            previous.profileId === next.profileId &&
            previous.review.hash === next.review.hash
              ? { ...next, idempotencyKey: previous.idempotencyKey }
              : null
          );
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [invoiceId, eligible, revision, readFinancial]);

  async function refreshDetails() {
    try {
      await onRefreshDetails();
      setRefreshError(false);
    } catch {
      setRefreshError(true);
    }
  }
  function refreshQuote() {
    setRevision((value) => value + 1);
    void refreshDetails();
  }

  if ((!eligible && !result) || hidden) return null;
  return (
    <section
      id="wallet-invoice-payment"
      aria-labelledby="wallet-invoice-payment-heading"
      className={recordEditorSurface}
    >
      <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-4 py-2 sm:px-6">
        <h2
          id="wallet-invoice-payment-heading"
          className="flex items-center gap-2 text-base font-semibold"
        >
          <WalletIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
          {text('title')}
        </h2>
        {!result && (
          <ListRefreshButton
            label={text('refresh')}
            refreshing={loading}
            disabled={open}
            onClick={refreshQuote}
          />
        )}
      </div>
      {result ? (
        <div className="space-y-3 px-4 py-4 sm:px-6">
          <div role="status" className="space-y-3">
            <h3
              ref={receiptHeading}
              tabIndex={-1}
              className="flex items-center gap-2 rounded-sm text-sm font-semibold"
            >
              <CircleCheckIcon className="size-4 shrink-0 text-success" aria-hidden="true" />
              {text('paid')}
            </h3>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">{text('paymentTotal')}</dt>
                <dd className="text-base font-semibold tabular-nums [overflow-wrap:anywhere]">
                  <bdi>{numbers.money(result.amount)}</bdi>
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">{text('reference')}</dt>
                <dd className="text-sm font-medium [overflow-wrap:anywhere]">
                  <bdi>{result.transactionId}</bdi>
                </dd>
              </div>
            </dl>
          </div>
          {refreshError && (
            <Alert variant="warning">
              <AlertDescription>{text('refreshError')}</AlertDescription>
            </Alert>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-3 px-4 py-4 sm:px-6">
            {loading ? (
              <LoadingStatus>{text('loading')}</LoadingStatus>
            ) : error ? (
              <Alert variant="destructive">
                <AlertDescription>{text('loadError')}</AlertDescription>
              </Alert>
            ) : (
              quote && (
                <>
                  <dl className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,8.5rem),1fr))] gap-3">
                    <div className="min-w-0">
                      <dt className="text-xs text-muted-foreground">{text('remaining')}</dt>
                      <dd className="text-base font-semibold tabular-nums [overflow-wrap:anywhere]">
                        <bdi>{numbers.money(quote.remainingAmount)}</bdi>
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs text-muted-foreground">{text('available')}</dt>
                      <dd className="text-base font-semibold tabular-nums [overflow-wrap:anywhere]">
                        <bdi>{numbers.money(quote.availableBalance)}</bdi>
                      </dd>
                    </div>
                  </dl>
                  {!quote.review.data.totals && (
                    <p className="text-sm text-muted-foreground">{text('legacyBreakdown')}</p>
                  )}
                  {!quote.canPay && (
                    <>
                      <p className="text-sm text-muted-foreground">{text('unavailable')}</p>
                      <WalletFundingPrompt
                        balance={quote.availableBalance}
                        total={quote.remainingAmount}
                        returnInvoiceId={invoiceId}
                      />
                    </>
                  )}
                </>
              )
            )}
            {intent && unconfirmed && !open && (
              <Alert variant="warning">
                <p className="font-medium">{confirmationText('unconfirmed', locale)}</p>
                <AlertDescription>
                  <p>{text('retryHint')}</p>
                  <p className="text-xs [overflow-wrap:anywhere]">
                    {text('request')} <bdi>{intent.idempotencyKey}</bdi>
                  </p>
                </AlertDescription>
              </Alert>
            )}
            {time.notice}
          </div>
          <RecordEditorActions>
            <Button
              ref={paymentButton}
              disabled={loading || open || !quote?.canPay || time.status !== 'ready'}
              onClick={() => {
                if (!quote?.canPay || time.status !== 'ready') return;
                if (!intent) {
                  setUnconfirmed(false);
                  setIntent({ ...quote, idempotencyKey: crypto.randomUUID() });
                }
                setOpen(true);
              }}
            >
              {intent && unconfirmed ? text('retry') : text('pay')}
            </Button>
          </RecordEditorActions>
        </>
      )}
      {open && intent && paymentAction && (
        <Suspense fallback={<p role="status">{text('loading')}</p>}>
          <TeamActionDialog
            risk="financial"
            focusSummary
            confirmationDisabled={time.status !== 'ready'}
            action={paymentAction}
            finalFocus={() => receiptHeading.current ?? paymentButton.current}
            summary={
              <div
                className="wallet-payment-review space-y-3"
                role="region"
                aria-label={text('reviewContent')}
                // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The review scrolls independently and needs keyboard access.
                tabIndex={0}
              >
                {time.notice}
                {unconfirmed && (
                  <p className="text-sm text-muted-foreground">{text('retryHint')}</p>
                )}
                <WalletPaymentReviewSummary review={intent.review} formatDate={time.format} />
              </div>
            }
            onClose={() => setOpen(false)}
            onUnconfirmed={() => setUnconfirmed(true)}
            onSuccess={async (value) => {
              const data = value as {
                invoiceId?: unknown;
                profileId?: unknown;
                idempotencyKey?: unknown;
                state?: unknown;
                amount?: unknown;
                walletTransactionId?: unknown;
                reviewHash?: unknown;
              } | null;
              if (
                !data ||
                data.invoiceId !== intent.invoiceId ||
                data.profileId !== intent.profileId ||
                data.idempotencyKey !== intent.idempotencyKey ||
                data.state !== 'Paid' ||
                data.amount !== intent.remainingAmount ||
                data.reviewHash !== intent.review.hash ||
                typeof data.walletTransactionId !== 'string' ||
                !isInvoiceUuid(data.walletTransactionId)
              )
                throw new Error('Unconfirmed payment response');
              setUnconfirmed(false);
              setResult({
                amount: intent.remainingAmount,
                transactionId: data.walletTransactionId,
              });
              await refreshDetails();
            }}
          />
        </Suspense>
      )}
    </section>
  );
}
