import { useProfileContextRevision } from '../lib/profile-context.js';
import { Alert, AlertDescription } from '@barghsa/ui';
import { FormField } from '@barghsa/ui/form';
import { Loader2 } from 'lucide-react';
import { useWizardForm as useDraftForm } from '../hooks/useWizardForm.js';
import { useReceiptForm } from '../hooks/useReceiptForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { TransactionList } from '../components/WalletTransactionList.js';
import { Currency } from '../components/Currency.js';
import {
  OnlinePaymentReturnPanel,
  type WalletPaymentReturn,
} from '../components/OnlinePaymentReturnPanel.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '@barghsa/i18n/app';
import type { OnlineTopUpReview } from '@barghsa/shared/finance';
import type { BankReceiptTopUpReview } from '@barghsa/shared/finance';
import {
  parseBankReceiptTopUpAmountIrR,
  parseBankReceiptBankName,
  isValidWalletTopUpLimit,
} from '@barghsa/shared/finance/browser';
import type { OnlineTopUpActionError } from '../lib/online-topup-action.js';
import { useLocale } from '../hooks/useLocale.js';
import {
  uploadInvoiceReceiptAttachment as uploadReceiptAttachment,
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
  | 'invalid-bank-name'
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
interface WalletPageProps {
  paymentReturn?: WalletPaymentReturn | undefined;
  returnInvoiceId?: string | undefined;
  historyQuery?: ListQueryBinding;
}
export function WalletPage(props: WalletPageProps = {}) {
  const revision = useProfileContextRevision();
  return <CustomerWalletPage key={revision} {...props} />;
}
function CustomerWalletPage({ paymentReturn, returnInvoiceId, historyQuery }: WalletPageProps) {
  const receiptFileInput = useRef<HTMLInputElement>(null);
  const locale = useLocale();
  const maintenance = useMaintenance('wallet_topup');
  const numbers = useNumberFormatting(locale);
  const isRtl = locale === 'fa';

  const [profileId, setProfileId] = useState<string | null>(null);
  const [wallet, setWallet] = useState<WalletBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<PageError | null>(null);
  const online = useDraftForm<{ amount: string }>(
    async () => {
      const { createOnlineTopUpSchema } = await import('../lib/customer-finance-form-schemas.js');
      return createOnlineTopUpSchema(advertisedOnlineTopUpLimit(wallet), {
        invalid: t('wallet.page.invalidAmount', locale),
        limit: t('wallet.page.limitExceeded', locale),
      });
    },
    { amount: '' },
    t('wallet.page.loadError', locale)
  );
  const [amountInput, setAmountInput] = online.field('amount');
  const invalidOnlineAmount = useActionFieldErrors(
    online.form,
    { amount: t('wallet.page.invalidAmount', locale) },
    t('wallet.page.loadError', locale)
  );
  const exceededOnlineAmount = useActionFieldErrors(
    online.form,
    { amount: t('wallet.page.limitExceeded', locale) },
    t('wallet.page.loadError', locale)
  );
  const onlinePending = useRef(false),
    receiptPending = useRef(false),
    mounted = useRef(false);
  const liveProfile = useRef(profileId);
  liveProfile.current = profileId;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [submitting, setSubmitting] = useState(false);
  const [onlineReview, setOnlineReview] = useState<OnlineTopUpReview | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  const receipt = useReceiptForm('wallet', parseBankReceiptTopUpAmountIrR);
  const [receiptAmountInput, setReceiptAmountInput] = receipt.field('amount');
  const [receiptDate, setReceiptDate] = receipt.field('paymentDate');
  const [receiptPayerRef, setReceiptPayerRef] = receipt.field('payerReference');
  const [receiptNote, setReceiptNote] = receipt.field('customerNote');
  const [receiptBankName, setReceiptBankName] = receipt.field('bankName');
  const [, setReceiptFile] = receipt.field('file');
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
      if (!mounted.current) return;
      if (!profileRes.ok) {
        setError('load');
        return;
      }
      const profileData: { activeProfileId: string | null } = await profileRes.json();
      if (!mounted.current) return;
      if (!profileData.activeProfileId) {
        setError('no-profile');
        setProfileId(null);
        return;
      }
      setProfileId(profileData.activeProfileId);

      const walletRes = await fetch(`/api/wallet/${profileData.activeProfileId}`, {
        credentials: 'include',
      });
      if (!mounted.current) return;
      if (!walletRes.ok) {
        setError('load');
        return;
      }
      const walletData: WalletBalance = await walletRes.json();
      if (mounted.current) setWallet(walletData);
    } catch {
      if (mounted.current) setError('load');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSubmit = online.form.handleSubmit(async (values) => {
    if (
      !profileId ||
      onlineReview ||
      onlinePending.current ||
      maintenance?.active ||
      !mounted.current
    )
      return;
    const current = () => mounted.current && liveProfile.current === profileId;
    onlinePending.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const { loadOnlineTopUpReview } = await import('../lib/online-topup-action.js');
      if (!current()) return;
      const result = await loadOnlineTopUpReview(profileId, Number(values.amount), idempotencyKey);
      if (!current()) return;
      if (result.kind === 'error') handleOnlineTopUpError(result);
      else setOnlineReview(result.review);
    } catch {
      if (current()) setError('gateway');
    } finally {
      if (current()) {
        onlinePending.current = false;
        setSubmitting(false);
      }
    }
  });

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
    if (result.error === 'invalid-amount') {
      invalidOnlineAmount(['amount']);
      setError(null);
    } else if (result.error === 'limit-exceeded') {
      exceededOnlineAmount(['amount']);
      setError(null);
    } else setError(result.error);
  }

  async function confirmOnlineTopUp() {
    if (!onlineReview || onlinePending.current || !mounted.current) return;
    const current = () => mounted.current && liveProfile.current === onlineReview.data.profileId;
    if (!current()) return;
    onlinePending.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const { startReviewedOnlineTopUp } = await import('../lib/online-topup-action.js');
      if (!current()) return;
      const result = await startReviewedOnlineTopUp(onlineReview, idempotencyKey);
      if (!current()) return;
      if (result.kind === 'error') {
        handleOnlineTopUpError(result);
        return;
      }
      if (returnInvoiceId && result.transactionId)
        rememberWalletInvoiceReturn(result.transactionId, returnInvoiceId);
      setOnlineReview(null);
      window.location.assign(result.redirectUrl);
    } catch {
      if (current()) {
        setOnlineReview(null);
        setError('gateway');
      }
    } finally {
      if (current()) {
        onlinePending.current = false;
        setSubmitting(false);
      }
    }
  }

  const handleReceiptSubmit = receipt.form.handleSubmit(async (values) => {
    if (
      !profileId ||
      receiptReview ||
      receiptPending.current ||
      maintenance?.active ||
      !mounted.current
    )
      return;
    const selectedFile = values.file;
    if (!selectedFile) return;
    const current = () => mounted.current && liveProfile.current === profileId;
    receiptPending.current = true;
    setReceiptSubmitting(true);
    setReceiptError(null);
    setReceiptSuccess(false);
    try {
      const attachmentKey =
        receiptUploaded?.file === selectedFile && receiptUploaded.profileId === profileId
          ? receiptUploaded.key
          : await uploadReceiptAttachment(selectedFile, profileId);
      if (!current()) return;
      if (!attachmentKey) {
        setReceiptError('upload');
        return;
      }
      setReceiptUploaded({ file: selectedFile, profileId, key: attachmentKey });
      const { loadBankReceiptTopUpReview } = await import('../lib/bank-receipt-topup-action.js');
      if (!current()) return;
      const bankName = parseBankReceiptBankName(values.bankName);
      const result = await loadBankReceiptTopUpReview({
        profileId,
        amountIrR: parseBankReceiptTopUpAmountIrR(
          normalizeIrrAmountDigits(values.amount)
        )!.toString(),
        paymentDate: values.paymentDate,
        payerReference: values.payerReference.trim(),
        attachmentKey,
        customerNote: values.customerNote.trim() || null,
        ...(bankName ? { bankName } : {}),
        idempotencyKey: receiptIdempotencyKey,
      });
      if (!current()) return;
      if (result.kind === 'error') {
        const next = mapReceiptSubmitError(result.status);
        if (next === 'conflict') setReceiptIdempotencyKey(newIdempotencyKey());
        if (receipt.applyServerErrors(result.fields)) {
          if (result.fields?.includes('attachmentKey')) setReceiptUploaded(null);
        } else setReceiptError(next);
        return;
      }
      setReceiptReview(result.value);
    } catch {
      if (current()) setReceiptError('upload');
    } finally {
      if (current()) {
        receiptPending.current = false;
        setReceiptSubmitting(false);
      }
    }
  });

  async function confirmReceiptTopUp() {
    if (!receiptReview || receiptPending.current || !mounted.current) return;
    const current = () => mounted.current && liveProfile.current === receiptReview.data.profileId;
    if (!current()) return;
    receiptPending.current = true;
    setReceiptSubmitting(true);
    setReceiptError(null);
    try {
      const { submitReviewedBankReceiptTopUp } =
        await import('../lib/bank-receipt-topup-action.js');
      if (!current()) return;
      const result = await submitReviewedBankReceiptTopUp(receiptReview, receiptIdempotencyKey);
      if (!current()) return;
      if (result.kind === 'error') {
        setReceiptReview(null);
        const next = mapReceiptSubmitError(result.status);
        if (next === 'conflict') setReceiptIdempotencyKey(newIdempotencyKey());
        if (receipt.applyServerErrors(result.fields)) {
          if (result.fields?.includes('attachmentKey')) setReceiptUploaded(null);
        } else setReceiptError(next);
        return;
      }
      setReceiptReview(null);
      setReceiptSuccess(true);
      setReceiptIdempotencyKey(newIdempotencyKey());
      receipt.form.reset({ ...receipt.form.getValues(), file: null });
      setReceiptUploaded(null);
      if (receiptFileInput.current) receiptFileInput.current.value = '';
      const walletRes = await fetch(`/api/wallet/${receiptReview.data.profileId}`, {
        credentials: 'include',
      });
      if (current() && walletRes.ok) {
        const nextWallet = (await walletRes.json()) as WalletBalance;
        if (current()) setWallet(nextWallet);
      }
    } catch {
      if (current()) {
        setReceiptReview(null);
        setReceiptError('generic');
      }
    } finally {
      if (current()) {
        receiptPending.current = false;
        setReceiptSubmitting(false);
      }
    }
  }

  const onlineBusy = submitting || online.form.formState.isSubmitting;
  const receiptBusy = receiptSubmitting || receipt.form.formState.isSubmitting;
  const onlineLocked = onlineBusy || !!onlineReview;
  const receiptLocked = receiptBusy || !!receiptReview;
  const advertisedLimit = advertisedOnlineTopUpLimit(wallet);
  const onlineSubmitDisabled =
    onlineLocked ||
    maintenance?.active === true ||
    advertisedLimit === null ||
    advertisedLimit === 0;

  const validationError = online.errors.root?.validation?.message;
  const receiptValidationError = receipt.errors.root?.validation?.message;
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
            : receiptError === 'invalid-bank-name'
              ? t('wallet.page.receiptInvalidBankName', locale)
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
                {wallet.currency === 'IRR' ? (
                  <Currency amount={wallet.balance} showToman variant="large" locale={locale} />
                ) : (
                  `${numbers.irrDigits(wallet.balance)} ${wallet.currency}`
                )}
              </p>
            </section>
          )}

          {errorMessage && (error === 'load' || error === 'no-profile') && (
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
              noValidate
              onSubmit={handleSubmit}
              className="space-y-4 rounded-lg bg-card text-card-foreground p-6 shadow-sm"
            >
              {(validationError ||
                (errorMessage && error !== 'load' && error !== 'no-profile')) && (
                <Alert variant="destructive" data-testid="wallet-error">
                  <AlertDescription>{errorMessage || validationError}</AlertDescription>
                </Alert>
              )}
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
                  {...online.bind('amount')}
                  id="top-up-amount"
                  data-testid="wallet-amount"
                  name="amount"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  dir="ltr"
                  value={amountInput}
                  disabled={onlineLocked}
                  aria-describedby={[
                    'top-up-amount-hint',
                    online.errors.amount ? online.errorId('amount') : null,
                  ]
                    .filter(Boolean)
                    .join(' ')}
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
                {online.errors.amount && (
                  <p
                    id={online.errorId('amount')}
                    role="alert"
                    className="text-sm text-destructive"
                  >
                    {online.errors.amount.message}
                  </p>
                )}
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
                aria-busy={onlineBusy || undefined}
                className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary-dark disabled:opacity-60"
              >
                {onlineBusy && (
                  <Loader2
                    aria-hidden="true"
                    className="me-2 inline size-4 animate-spin motion-reduce:animate-none"
                  />
                )}
                {onlineBusy
                  ? t(onlineReview ? 'wallet.page.submitting' : 'wallet.page.reviewLoading', locale)
                  : t('wallet.page.submit', locale)}
              </button>
            </form>
          )}

          {profileId && !maintenance?.active && (
            <form
              noValidate
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

              {(receiptErrorMessage || receiptValidationError) && (
                <Alert variant="destructive" data-testid="wallet-receipt-error">
                  <AlertDescription>
                    {receiptErrorMessage || receiptValidationError}
                  </AlertDescription>
                </Alert>
              )}

              <div>
                <label
                  htmlFor="receipt-amount"
                  className="block text-sm font-medium text-foreground"
                >
                  {t('wallet.page.receiptAmountLabel', locale)}
                </label>
                <input
                  {...receipt.bind('amount')}
                  id="receipt-amount"
                  data-testid="wallet-receipt-amount"
                  name="receiptAmount"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={receiptAmountInput}
                  disabled={receiptLocked}
                  onChange={(event) => {
                    setReceiptAmountInput(normalizeIrrAmountDigits(event.target.value));
                    if (receiptError === 'invalid-amount') setReceiptError(null);
                  }}
                  className="mt-1 h-10 w-full rounded-lg border border-input px-3 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                {receipt.errors.amount && (
                  <p
                    id={receipt.errorId('amount')}
                    role="alert"
                    className="text-sm text-destructive"
                  >
                    {receipt.errors.amount.message}
                  </p>
                )}
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
                  {...receipt.bind('paymentDate')}
                  id="receipt-date"
                  data-testid="wallet-receipt-date"
                  name="paymentDate"
                  type="date"
                  max={utcTodayIso()}
                  value={receiptDate}
                  disabled={receiptLocked}
                  onChange={(event) => {
                    setReceiptDate(event.target.value);
                    if (receiptError === 'invalid-date') setReceiptError(null);
                  }}
                  className="mt-1 h-10 w-full rounded-lg border border-input px-3 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                {receipt.errors.paymentDate && (
                  <p
                    id={receipt.errorId('paymentDate')}
                    role="alert"
                    className="text-sm text-destructive"
                  >
                    {receipt.errors.paymentDate.message}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="receipt-payer-ref"
                  className="block text-sm font-medium text-foreground"
                >
                  {t('wallet.page.receiptPayerRefLabel', locale)}
                </label>
                <input
                  {...receipt.bind('payerReference')}
                  id="receipt-payer-ref"
                  data-testid="wallet-receipt-payer-ref"
                  name="payerReference"
                  type="text"
                  autoComplete="off"
                  maxLength={128}
                  value={receiptPayerRef}
                  disabled={receiptLocked}
                  onChange={(event) => {
                    setReceiptPayerRef(event.target.value);
                    if (receiptError === 'invalid-payer-ref') setReceiptError(null);
                  }}
                  className="mt-1 h-10 w-full rounded-lg border border-input px-3 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                {receipt.errors.payerReference && (
                  <p
                    id={receipt.errorId('payerReference')}
                    role="alert"
                    className="text-sm text-destructive"
                  >
                    {receipt.errors.payerReference.message}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="receipt-bank-name"
                  className="block text-sm font-medium text-foreground"
                >
                  {t('invoices.details.receiptBankNameLabel', locale)}
                </label>
                <input
                  {...receipt.bind('bankName')}
                  id="receipt-bank-name"
                  data-testid="wallet-receipt-bank-name"
                  type="text"
                  maxLength={128}
                  autoComplete="off"
                  value={receiptBankName}
                  disabled={receiptLocked}
                  onChange={(event) => {
                    setReceiptBankName(event.target.value);
                    if (receiptError === 'invalid-bank-name') setReceiptError(null);
                  }}
                  className="mt-2 w-full rounded-lg border border-border bg-background p-3 text-foreground"
                />
                {receipt.errors.bankName && (
                  <p
                    id={receipt.errorId('bankName')}
                    role="alert"
                    className="text-sm text-destructive"
                  >
                    {receipt.errors.bankName.message}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="receipt-file" className="block text-sm font-medium text-foreground">
                  {t('wallet.page.receiptFileLabel', locale)}
                </label>
                <FormField
                  control={receipt.form.control}
                  name="file"
                  render={({ field }) => (
                    <input
                      ref={(element) => {
                        field.ref(element);
                        receiptFileInput.current = element;
                      }}
                      onBlur={field.onBlur}
                      aria-invalid={!!receipt.errors.file || undefined}
                      id="receipt-file"
                      data-testid="wallet-receipt-file"
                      name="receiptFile"
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                      disabled={receiptLocked}
                      aria-describedby={[
                        'receipt-file-hint',
                        receipt.errors.file ? receipt.errorId('file') : null,
                      ]
                        .filter(Boolean)
                        .join(' ')}
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
                  )}
                />
                <p id="receipt-file-hint" className="mt-2 text-sm text-muted-foreground">
                  {t('wallet.page.receiptFileHint', locale)}
                </p>
                {receipt.errors.file && (
                  <p id={receipt.errorId('file')} role="alert" className="text-sm text-destructive">
                    {receipt.errors.file.message}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="receipt-note" className="block text-sm font-medium text-foreground">
                  {t('wallet.page.receiptNoteLabel', locale)}
                </label>
                <textarea
                  {...receipt.bind('customerNote')}
                  id="receipt-note"
                  data-testid="wallet-receipt-note"
                  name="customerNote"
                  rows={3}
                  maxLength={2000}
                  value={receiptNote}
                  disabled={receiptLocked}
                  onChange={(event) => setReceiptNote(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-input px-3 py-2 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                {receipt.errors.customerNote && (
                  <p
                    id={receipt.errorId('customerNote')}
                    role="alert"
                    className="text-sm text-destructive"
                  >
                    {receipt.errors.customerNote.message}
                  </p>
                )}
              </div>

              <button
                type="submit"
                data-testid="wallet-receipt-submit"
                disabled={receiptLocked}
                aria-busy={receiptBusy || undefined}
                className="w-full rounded-lg border border-primary bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {receiptBusy && (
                  <Loader2
                    aria-hidden="true"
                    className="me-2 inline size-4 animate-spin motion-reduce:animate-none"
                  />
                )}
                {receiptBusy
                  ? t('wallet.page.receiptSubmitting', locale)
                  : t('wallet.page.receiptSubmit', locale)}
              </button>
            </form>
          )}

          {profileId && (
            <TransactionList
              key={`${profileId}-${receiptSuccess}`}
              profileId={profileId}
              locale={locale}
              {...(historyQuery ? { binding: historyQuery } : {})}
            />
          )}

          {onlineReview ? (
            <Suspense fallback={<p role="status">{t('wallet.page.reviewLoading', locale)}</p>}>
              <OnlineTopUpReviewDialog
                review={onlineReview}
                locale={locale}
                loading={onlineBusy}
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
                loading={receiptBusy}
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
