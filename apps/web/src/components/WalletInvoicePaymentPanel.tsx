import { lazy, Suspense, useEffect, useState } from 'react';
import { Alert, AlertDescription, Button } from '@barghsa/ui';
import { tWalletInvoicePayment as t } from '@barghsa/i18n/wallet-invoice-payment';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { isInvoiceUuid } from '../lib/due-at-override.js';
const TeamActionDialog = lazy(() =>
  import('./TeamActionDialog.js').then((module) => ({ default: module.TeamActionDialog }))
);

type Quote = {
  invoiceId: string;
  profileId: string;
  remainingAmount: string;
  availableBalance: string;
  canPay: boolean;
};
type Intent = Quote & { idempotencyKey: string };
function quoteFrom(value: unknown, invoiceId: string): Quote {
  const q = value as Partial<Quote> | null;
  if (
    !q ||
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
  return q as Quote;
}

export function WalletInvoicePaymentPanel({
  invoiceId,
  eligible,
  onRefreshDetails,
}: {
  invoiceId: string;
  eligible: boolean;
  onRefreshDetails: () => Promise<void>;
}) {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale);
  const text = (key: Parameters<typeof t>[0]) => t(key, locale);
  const [quote, setQuote] = useState<Quote | null>(null),
    [intent, setIntent] = useState<Intent | null>(null);
  const [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [hidden, setHidden] = useState(false),
    [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ amount: string; transactionId: string } | null>(null),
    [refreshError, setRefreshError] = useState(false);
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
    void fetch(`/api/invoices/${invoiceId}/wallet-payment`, { signal: abort.signal })
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
            previous.remainingAmount === next.remainingAmount
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
  }, [invoiceId, eligible, revision]);

  async function refreshDetails() {
    try {
      await onRefreshDetails();
      setRefreshError(false);
    } catch {
      setRefreshError(true);
    }
  }
  if ((!eligible && !result) || hidden) return null;
  return (
    <section
      id="wallet-invoice-payment"
      aria-labelledby="wallet-invoice-payment-heading"
      className="space-y-4 rounded-lg border p-4"
    >
      <h2 id="wallet-invoice-payment-heading" className="text-lg font-semibold">
        {text('title')}
      </h2>
      {result ? (
        <div role="status" className="space-y-2">
          <p>
            {text('paid')} <strong>{numbers.money(result.amount)}</strong>
          </p>
          <p>
            {text('reference')} <bdi>{result.transactionId}</bdi>
          </p>
          {refreshError && <p>{text('refreshError')}</p>}
        </div>
      ) : (
        <>
          {loading ? (
            <p role="status">{text('loading')}</p>
          ) : error ? (
            <Alert variant="destructive">
              <AlertDescription>{text('loadError')}</AlertDescription>
            </Alert>
          ) : (
            quote && (
              <>
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <dt>{text('remaining')}</dt>
                    <dd className="font-semibold">{numbers.money(quote.remainingAmount)}</dd>
                  </div>
                  <div>
                    <dt>{text('available')}</dt>
                    <dd className="font-semibold">{numbers.money(quote.availableBalance)}</dd>
                  </div>
                </dl>
                {!quote.canPay && <p>{text('unavailable')}</p>}
              </>
            )
          )}
          {intent && (
            <div className="space-y-1 text-sm">
              <p>{text('retryHint')}</p>
              <p>
                {text('request')} <bdi>{intent.idempotencyKey}</bdi>
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              className="hover:bg-primary"
              disabled={loading || open || !quote?.canPay}
              onClick={() => {
                if (!quote?.canPay) return;
                if (!intent) setIntent({ ...quote, idempotencyKey: crypto.randomUUID() });
                setOpen(true);
              }}
            >
              {intent ? text('retry') : text('pay')}
            </Button>
            <Button
              variant="outline"
              disabled={loading || open}
              onClick={() => {
                setRevision((v) => v + 1);
                void refreshDetails();
              }}
            >
              {text('refresh')}
            </Button>
          </div>
        </>
      )}
      {open && intent && (
        <Suspense fallback={<p role="status">{text('loading')}</p>}>
          <TeamActionDialog
            action={{
              title: text('confirm'),
              description: text('description')
                .replace('{amount}', numbers.money(intent.remainingAmount))
                .replace('{invoice}', intent.invoiceId)
                .replace('{balance}', numbers.money(intent.availableBalance)),
              path: `/api/invoices/${intent.invoiceId}/wallet-payment`,
              method: 'POST',
              body: {
                idempotencyKey: intent.idempotencyKey,
                expectedRemainingAmount: intent.remainingAmount,
              },
              conflictMessage: text('conflict'),
              forbiddenMessage: text('denied'),
            }}
            onClose={() => setOpen(false)}
            onSuccess={async (value) => {
              const data = value as {
                invoiceId?: unknown;
                profileId?: unknown;
                idempotencyKey?: unknown;
                state?: unknown;
                amount?: unknown;
                walletTransactionId?: unknown;
              } | null;
              if (
                !data ||
                data.invoiceId !== intent.invoiceId ||
                data.profileId !== intent.profileId ||
                data.idempotencyKey !== intent.idempotencyKey ||
                data.state !== 'Paid' ||
                data.amount !== intent.remainingAmount ||
                typeof data.walletTransactionId !== 'string' ||
                !isInvoiceUuid(data.walletTransactionId)
              )
                throw new Error('Unconfirmed payment response');
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
