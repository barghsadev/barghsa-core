import { WalletTransactionList } from '../components/WalletTransactionList.js';
import {
  OnlinePaymentReturnPanel,
  type WalletPaymentReturn,
} from '../components/OnlinePaymentReturnPanel.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { t } from '@barghsa/i18n/app';
import type { OnlineTopUpReview } from '@barghsa/shared/finance';
import type { BankReceiptTopUpReview } from '@barghsa/shared/finance';
import {
  parseBankReceiptTopUpAmountIrR,
  isValidWalletTopUpLimit,
} from '@barghsa/shared/finance/browser';
import type { OnlineTopUpActionError } from '../lib/online-topup-action.js';
import { useLocale } from '../hooks/useLocale.js';
import { useReceiptAttachmentUpload } from '../hooks/useReceiptAttachmentUpload.js';
import {
  isAllowedInvoiceReceiptFile as isAllowedReceiptFile,
  normalizeIrrAmountDigits,
  utcTodayIso,
} from '../lib/invoice-bank-receipt-upload.js';
import { rememberWalletInvoiceReturn } from '../lib/wallet-invoice-return.js';
import { useMaintenance } from '../hooks/useMaintenance.js';
import { MaintenanceNotice } from '../components/MaintenanceNotice.js';
import { tMaintenance } from '@barghsa/i18n/maintenance';

const OnlineTopUpReviewDialog = lazy(() => import('../components/OnlineTopUpReviewDialog.js'));
const BankReceiptTopUpReviewDialog = lazy(
  () => import('../components/BankReceiptTopUpReviewDialog.js')
);

interface WalletBalance {
  balance: string;
  postedBalance?: number;
  reservedBalance?: number;
  currency: string;
  onlineTopUpLimit?: number;
  configVersion?: number;
}

/** Advertised per-transaction ceiling, or `null` when GET did not return a valid limit. */
function advertisedOnlineTopUpLimit(wallet: WalletBalance | null): number | null {
  if (!wallet || !isValidWalletTopUpLimit(wallet.onlineTopUpLimit)) return null;
  return wallet.onlineTopUpLimit;
}

type PageError = 'no-profile' | 'load' | OnlineTopUpActionError;

type ReceiptError =
  | 'invalid-amount'
  | 'invalid-date'
  | 'invalid-payer-ref'
  | 'invalid-file'
  | 'upload'
  | 'conflict'
  | 'maintenance'
  | 'generic';

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

function mapReceiptSubmitError(status: number): ReceiptError {
  if (status === 503) return 'maintenance';
  if (status === 409) return 'conflict';
  if (status === 400) return 'generic';
  return 'generic';
}

/**
 * Customer wallet top-up page (T-04.2.02.01 / T-04.2.02.03).
 *
 * Online: collects a positive IRR amount, starts a Pending ledger row plus
 * provider session, and redirects to the gateway.
 * Bank receipt: collects amount, date, payer ref, attachment, and note;
 * uploads the file, then creates a Pending top-up. The wallet is credited
 * only after provider callback or finance confirmation.
 */
export function WalletPage({
  paymentReturn,
  returnInvoiceId,
}: { paymentReturn?: WalletPaymentReturn | undefined; returnInvoiceId?: string | undefined } = {}) {
  const uploadReceiptAttachment = useReceiptAttachmentUpload();
  const receiptFileInput = useRef<HTMLInputElement>(null);
  const locale = useLocale();
  const maintenance = useMaintenance('wallet_topup');
  const numbers = useNumberFormatting(locale);
  const isRtl = locale === 'fa';

  const [profileId, setProfileId] = useState<string | null>(null);
  const [wallet, setWallet] = useState<WalletBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<PageError | null>(null);
  const [amountInput, setAmountInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [onlineReview, setOnlineReview] = useState<OnlineTopUpReview | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  const [receiptAmountInput, setReceiptAmountInput] = useState('');
  const [receiptDate, setReceiptDate] = useState('');
  const [receiptPayerRef, setReceiptPayerRef] = useState('');
  const [receiptNote, setReceiptNote] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptUploaded, setReceiptUploaded] = useState<{
    file: File;
    profileId: string;
    key: string;
  } | null>(null);
  const [receiptReview, setReceiptReview] = useState<BankReceiptTopUpReview | null>(null);
  const [receiptSubmitting, setReceiptSubmitting] = useState(false);
  const [receiptError, setReceiptError] = useState<ReceiptError | null>(null);
  const [receiptSuccess, setReceiptSuccess] = useState(false);
  const [receiptIdempotencyKey, setReceiptIdempotencyKey] = useState(newIdempotencyKey);

  const amountDigits = normalizeIrrAmountDigits(amountInput);
  const amountValue = amountDigits === '' ? null : Number(amountDigits);
  const tomanPreview = useMemo(() => {
    if (amountValue === null || !Number.isSafeInteger(amountValue)) return null;
    return Math.round(amountValue / 10);
  }, [amountValue]);

  const receiptAmountDigits = normalizeIrrAmountDigits(receiptAmountInput);
  const receiptAmountIrR = useMemo(
    () => parseBankReceiptTopUpAmountIrR(receiptAmountDigits),
    [receiptAmountDigits]
  );
  const receiptTomanPreview = useMemo(() => {
    if (receiptAmountIrR === null) return null;
    return receiptAmountIrR / 10n;
  }, [receiptAmountIrR]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const profileRes = await fetch('/api/profiles', { credentials: 'include' });
      if (!profileRes.ok) {
        setError('load');
        return;
      }
      const profileData: { activeProfileId: string | null } = await profileRes.json();
      if (!profileData.activeProfileId) {
        setError('no-profile');
        setProfileId(null);
        return;
      }
      setProfileId(profileData.activeProfileId);

      const walletRes = await fetch(`/api/wallet/${profileData.activeProfileId}`, {
        credentials: 'include',
      });
      if (!walletRes.ok) {
        setError('load');
        return;
      }
      const walletData: WalletBalance = await walletRes.json();
      setWallet(walletData);
    } catch {
      setError('load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profileId || submitting || maintenance?.active) return;

    if (amountValue === null || !Number.isSafeInteger(amountValue) || amountValue <= 0) {
      setError('invalid-amount');
      return;
    }

    const limitIrR = advertisedOnlineTopUpLimit(wallet);
    if (limitIrR === null || limitIrR === 0 || amountValue > limitIrR) {
      setError('limit-exceeded');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const { loadOnlineTopUpReview } = await import('../lib/online-topup-action.js');
      const result = await loadOnlineTopUpReview(profileId, amountValue, idempotencyKey);
      if (result.kind === 'error') handleOnlineTopUpError(result);
      else setOnlineReview(result.review);
    } catch {
      setError('gateway');
    } finally {
      setSubmitting(false);
    }
  }

  function handleOnlineTopUpError(result: {
    error: OnlineTopUpActionError;
    enforcedLimit: { onlineTopUpLimit: number; configVersion: number } | null;
  }) {
    if (['limit-exceeded', 'invalid-amount', 'conflict'].includes(result.error)) {
      setIdempotencyKey(newIdempotencyKey());
    }
    if (result.enforcedLimit) {
      setWallet((prev) =>
        prev
          ? {
              ...prev,
              onlineTopUpLimit: result.enforcedLimit!.onlineTopUpLimit,
              configVersion: result.enforcedLimit!.configVersion,
            }
          : prev
      );
    }
    setOnlineReview(null);
    setError(result.error);
  }

  async function confirmOnlineTopUp() {
    if (!onlineReview || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { startReviewedOnlineTopUp } = await import('../lib/online-topup-action.js');
      const result = await startReviewedOnlineTopUp(onlineReview, idempotencyKey);
      if (result.kind === 'error') {
        handleOnlineTopUpError(result);
        return;
      }
      if (returnInvoiceId && result.transactionId)
        rememberWalletInvoiceReturn(result.transactionId, returnInvoiceId);
      setOnlineReview(null);
      window.location.assign(result.redirectUrl);
    } catch {
      setOnlineReview(null);
      setError('gateway');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReceiptSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profileId || receiptSubmitting || maintenance?.active) return;

    if (receiptAmountIrR === null) {
      setReceiptError('invalid-amount');
      setReceiptSuccess(false);
      return;
    }
    if (!receiptDate || receiptDate > utcTodayIso()) {
      setReceiptError('invalid-date');
      setReceiptSuccess(false);
      return;
    }
    if (receiptPayerRef.trim().length === 0) {
      setReceiptError('invalid-payer-ref');
      setReceiptSuccess(false);
      return;
    }
    if (!receiptFile || !isAllowedReceiptFile(receiptFile)) {
      setReceiptError('invalid-file');
      setReceiptSuccess(false);
      return;
    }

    setReceiptSubmitting(true);
    setReceiptError(null);
    setReceiptSuccess(false);
    try {
      const attachmentKey =
        receiptUploaded?.file === receiptFile && receiptUploaded.profileId === profileId
          ? receiptUploaded.key
          : await uploadReceiptAttachment(receiptFile, profileId);
      if (!attachmentKey) {
        setReceiptError('upload');
        return;
      }
      setReceiptUploaded({ file: receiptFile, profileId, key: attachmentKey });
      const { loadBankReceiptTopUpReview } = await import('../lib/bank-receipt-topup-action.js');
      const result = await loadBankReceiptTopUpReview({
        profileId,
        amountIrR: receiptAmountIrR.toString(),
        paymentDate: receiptDate,
        payerReference: receiptPayerRef.trim(),
        attachmentKey,
        customerNote: receiptNote.trim() || null,
        idempotencyKey: receiptIdempotencyKey,
      });
      if (result.kind === 'error') {
        const next = mapReceiptSubmitError(result.status);
        if (next === 'conflict') setReceiptIdempotencyKey(newIdempotencyKey());
        setReceiptError(next);
        return;
      }
      setReceiptReview(result.value);
    } catch {
      setReceiptError('upload');
    } finally {
      setReceiptSubmitting(false);
    }
  }

  async function confirmReceiptTopUp() {
    if (!receiptReview || receiptSubmitting) return;
    setReceiptSubmitting(true);
    setReceiptError(null);
    try {
      const { submitReviewedBankReceiptTopUp } =
        await import('../lib/bank-receipt-topup-action.js');
      const result = await submitReviewedBankReceiptTopUp(receiptReview, receiptIdempotencyKey);
      if (result.kind === 'error') {
        setReceiptReview(null);
        const next = mapReceiptSubmitError(result.status);
        if (next === 'conflict') setReceiptIdempotencyKey(newIdempotencyKey());
        setReceiptError(next);
        return;
      }
      setReceiptReview(null);
      setReceiptSuccess(true);
      setReceiptIdempotencyKey(newIdempotencyKey());
      setReceiptFile(null);
      setReceiptUploaded(null);
      if (receiptFileInput.current) receiptFileInput.current.value = '';
      const walletRes = await fetch(`/api/wallet/${receiptReview.data.profileId}`, {
        credentials: 'include',
      });
      if (walletRes.ok) {
        setWallet((await walletRes.json()) as WalletBalance);
      }
    } catch {
      setReceiptReview(null);
      setReceiptError('generic');
    } finally {
      setReceiptSubmitting(false);
    }
  }

  const advertisedLimit = advertisedOnlineTopUpLimit(wallet);
  const onlineSubmitDisabled =
    submitting || maintenance?.active === true || advertisedLimit === null || advertisedLimit === 0;

  const errorMessage =
    error === null
      ? null
      : error === 'no-profile'
        ? t('wallet.page.noProfile', locale)
        : error === 'load'
          ? t('wallet.page.loadError', locale)
          : error === 'limit-exceeded'
            ? t('wallet.page.limitExceeded', locale)
            : error === 'invalid-amount'
              ? t('wallet.page.invalidAmount', locale)
              : error === 'gateway'
                ? t('wallet.page.gatewayError', locale)
                : error === 'conflict'
                  ? t('wallet.page.conflict', locale)
                  : error === 'maintenance'
                    ? tMaintenance('title', locale)
                    : t('wallet.page.loadError', locale);

  const receiptErrorMessage =
    receiptError === null
      ? null
      : receiptError === 'invalid-amount'
        ? t('wallet.page.invalidAmount', locale)
        : receiptError === 'invalid-date'
          ? t('wallet.page.receiptInvalidDate', locale)
          : receiptError === 'invalid-payer-ref'
            ? t('wallet.page.receiptInvalidPayerRef', locale)
            : receiptError === 'invalid-file'
              ? t('wallet.page.receiptInvalidFile', locale)
              : receiptError === 'upload'
                ? t('wallet.page.receiptUploadError', locale)
                : receiptError === 'conflict'
                  ? t('wallet.page.conflict', locale)
                  : receiptError === 'maintenance'
                    ? tMaintenance('title', locale)
                    : t('wallet.page.receiptGenericError', locale);

  return (
    <div
      className="mx-auto max-w-lg space-y-6"
      dir={isRtl ? 'rtl' : 'ltr'}
      data-testid="wallet-page"
    >
      <header>
        <h1 className="text-2xl font-bold text-foreground">{t('wallet.page.title', locale)}</h1>
        <p className="mt-2 text-muted-foreground">{t('wallet.page.subtitle', locale)}</p>
        {returnInvoiceId && (
          <a
            className="mt-3 inline-block text-sm font-medium text-primary underline"
            href={`/invoices/${encodeURIComponent(returnInvoiceId)}`}
          >
            {t('wallet.page.returnToInvoice', locale)}
          </a>
        )}
      </header>

      {paymentReturn && (
        <OnlinePaymentReturnPanel
          key={`${paymentReturn.orderId}:${paymentReturn.authority}`}
          payment={paymentReturn}
          locale={locale}
          onConfirmed={() => void load()}
        />
      )}

      {loading ? (
        <div
          className="h-40 rounded-lg bg-muted animate-pulse"
          aria-hidden="true"
          data-testid="wallet-loading"
        />
      ) : (
        <div className="space-y-6" data-testid="wallet-loaded">
          {wallet && (
            <section className="rounded-lg bg-card text-card-foreground p-6 shadow-sm">
              <p className="text-sm text-muted-foreground">
                {t('wallet.page.currentBalance', locale)}
              </p>
              <p className="mt-1 text-3xl font-bold text-foreground" data-testid="wallet-balance">
                {wallet.currency === 'IRR'
                  ? numbers.money(wallet.balance)
                  : `${numbers.irrDigits(wallet.balance)} ${wallet.currency}`}
              </p>
            </section>
          )}

          {errorMessage && (
            <div
              role="alert"
              data-testid="wallet-error"
              className="rounded-lg border border-destructive/20 bg-danger-soft p-3 text-sm text-destructive"
            >
              {errorMessage}
            </div>
          )}

          {maintenance?.active && <MaintenanceNotice setting={maintenance} />}

          {profileId && !maintenance?.active && (
            <form
              onSubmit={handleSubmit}
              className="space-y-4 rounded-lg bg-card text-card-foreground p-6 shadow-sm"
            >
              <h2 className="text-lg font-semibold text-foreground">
                {t('wallet.page.onlineTitle', locale)}
              </h2>
              <div>
                <label
                  htmlFor="top-up-amount"
                  className="block text-sm font-medium text-foreground"
                >
                  {t('wallet.page.amountLabel', locale)}
                </label>
                <input
                  id="top-up-amount"
                  data-testid="wallet-amount"
                  name="amount"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  dir="ltr"
                  value={amountInput}
                  disabled={submitting}
                  aria-invalid={error === 'invalid-amount' || error === 'limit-exceeded'}
                  aria-describedby="top-up-amount-hint"
                  onChange={(event) => {
                    setAmountInput(normalizeIrrAmountDigits(event.target.value));
                    if (error === 'invalid-amount' || error === 'limit-exceeded') setError(null);
                  }}
                  className="mt-1 h-10 w-full rounded-lg border border-input px-3 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <p id="top-up-amount-hint" className="mt-2 text-sm text-muted-foreground">
                  {advertisedLimit === 0
                    ? t('wallet.page.amountHintBlocked', locale)
                    : t('wallet.page.amountHint', locale).replace(
                        '{limit}',
                        advertisedLimit !== null ? numbers.irrDigits(advertisedLimit) : '—'
                      )}
                </p>
                {tomanPreview !== null && (
                  <p className="mt-1 text-sm text-muted-foreground" data-testid="wallet-toman">
                    {t('wallet.page.tomanPreview', locale).replace(
                      '{amount}',
                      numbers.irrDigits(tomanPreview)
                    )}
                  </p>
                )}
              </div>
              <button
                type="submit"
                data-testid="wallet-submit"
                disabled={onlineSubmitDisabled}
                className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary-dark disabled:opacity-60"
              >
                {submitting
                  ? t(onlineReview ? 'wallet.page.submitting' : 'wallet.page.reviewLoading', locale)
                  : t('wallet.page.submit', locale)}
              </button>
            </form>
          )}

          {profileId && !maintenance?.active && (
            <form
              onSubmit={handleReceiptSubmit}
              className="space-y-4 rounded-lg bg-card text-card-foreground p-6 shadow-sm"
              data-testid="wallet-receipt-form"
            >
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  {t('wallet.page.receiptTitle', locale)}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('wallet.page.receiptSubtitle', locale)}
                </p>
              </div>

              {receiptSuccess && (
                <div
                  role="status"
                  data-testid="wallet-receipt-success"
                  className="rounded-lg border border-success/20 bg-success-soft p-3 text-sm text-success"
                >
                  {t('wallet.page.receiptSuccess', locale)}
                </div>
              )}

              {receiptErrorMessage && (
                <div
                  role="alert"
                  data-testid="wallet-receipt-error"
                  className="rounded-lg border border-destructive/20 bg-danger-soft p-3 text-sm text-destructive"
                >
                  {receiptErrorMessage}
                </div>
              )}

              <div>
                <label
                  htmlFor="receipt-amount"
                  className="block text-sm font-medium text-foreground"
                >
                  {t('wallet.page.receiptAmountLabel', locale)}
                </label>
                <input
                  id="receipt-amount"
                  data-testid="wallet-receipt-amount"
                  name="receiptAmount"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={receiptAmountInput}
                  disabled={receiptSubmitting}
                  aria-invalid={receiptError === 'invalid-amount'}
                  onChange={(event) => {
                    setReceiptAmountInput(normalizeIrrAmountDigits(event.target.value));
                    if (receiptError === 'invalid-amount') setReceiptError(null);
                  }}
                  className="mt-1 h-10 w-full rounded-lg border border-input px-3 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                {receiptTomanPreview !== null && (
                  <p
                    className="mt-1 text-sm text-muted-foreground"
                    data-testid="wallet-receipt-toman"
                  >
                    {t('wallet.page.tomanPreview', locale).replace(
                      '{amount}',
                      numbers.irrDigits(receiptTomanPreview)
                    )}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="receipt-date" className="block text-sm font-medium text-foreground">
                  {t('wallet.page.receiptDateLabel', locale)}
                </label>
                <input
                  id="receipt-date"
                  data-testid="wallet-receipt-date"
                  name="paymentDate"
                  type="date"
                  max={utcTodayIso()}
                  value={receiptDate}
                  disabled={receiptSubmitting}
                  aria-invalid={receiptError === 'invalid-date'}
                  onChange={(event) => {
                    setReceiptDate(event.target.value);
                    if (receiptError === 'invalid-date') setReceiptError(null);
                  }}
                  className="mt-1 h-10 w-full rounded-lg border border-input px-3 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>

              <div>
                <label
                  htmlFor="receipt-payer-ref"
                  className="block text-sm font-medium text-foreground"
                >
                  {t('wallet.page.receiptPayerRefLabel', locale)}
                </label>
                <input
                  id="receipt-payer-ref"
                  data-testid="wallet-receipt-payer-ref"
                  name="payerReference"
                  type="text"
                  autoComplete="off"
                  maxLength={128}
                  value={receiptPayerRef}
                  disabled={receiptSubmitting}
                  aria-invalid={receiptError === 'invalid-payer-ref'}
                  onChange={(event) => {
                    setReceiptPayerRef(event.target.value);
                    if (receiptError === 'invalid-payer-ref') setReceiptError(null);
                  }}
                  className="mt-1 h-10 w-full rounded-lg border border-input px-3 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>

              <div>
                <label htmlFor="receipt-file" className="block text-sm font-medium text-foreground">
                  {t('wallet.page.receiptFileLabel', locale)}
                </label>
                <input
                  ref={receiptFileInput}
                  id="receipt-file"
                  data-testid="wallet-receipt-file"
                  name="receiptFile"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                  disabled={receiptSubmitting}
                  aria-invalid={receiptError === 'invalid-file'}
                  aria-describedby="receipt-file-hint"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setReceiptFile(file);
                    setReceiptUploaded(null);
                    if (receiptError === 'invalid-file' || receiptError === 'upload') {
                      setReceiptError(null);
                    }
                  }}
                  className="mt-1 block w-full text-sm text-muted-foreground file:me-4 file:rounded-lg file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground"
                />
                <p id="receipt-file-hint" className="mt-2 text-sm text-muted-foreground">
                  {t('wallet.page.receiptFileHint', locale)}
                </p>
              </div>

              <div>
                <label htmlFor="receipt-note" className="block text-sm font-medium text-foreground">
                  {t('wallet.page.receiptNoteLabel', locale)}
                </label>
                <textarea
                  id="receipt-note"
                  data-testid="wallet-receipt-note"
                  name="customerNote"
                  rows={3}
                  maxLength={2000}
                  value={receiptNote}
                  disabled={receiptSubmitting}
                  onChange={(event) => setReceiptNote(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-input px-3 py-2 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>

              <button
                type="submit"
                data-testid="wallet-receipt-submit"
                disabled={receiptSubmitting}
                className="w-full rounded-lg border border-primary bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {receiptSubmitting
                  ? t('wallet.page.receiptSubmitting', locale)
                  : t('wallet.page.receiptSubmit', locale)}
              </button>
            </form>
          )}

          {profileId && (
            <WalletTransactionList
              key={`${profileId}-${receiptSuccess}`}
              profileId={profileId}
              locale={locale}
            />
          )}

          {onlineReview ? (
            <Suspense fallback={<p role="status">{t('wallet.page.reviewLoading', locale)}</p>}>
              <OnlineTopUpReviewDialog
                review={onlineReview}
                locale={locale}
                loading={submitting}
                onCancel={() => setOnlineReview(null)}
                onConfirm={() => void confirmOnlineTopUp()}
              />
            </Suspense>
          ) : null}

          {receiptReview ? (
            <Suspense fallback={<p role="status">{t('wallet.page.reviewLoading', locale)}</p>}>
              <BankReceiptTopUpReviewDialog
                review={receiptReview}
                locale={locale}
                loading={receiptSubmitting}
                onCancel={() => setReceiptReview(null)}
                onConfirm={() => void confirmReceiptTopUp()}
              />
            </Suspense>
          ) : null}

          {(error === 'load' || error === 'gateway') && (
            <button
              type="button"
              onClick={() => void load()}
              className="text-sm font-medium text-foreground hover:underline"
            >
              {t('wallet.page.retry', locale)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
