import { useOwnedFinancialRead } from '../hooks/useOwnedFinancialRead.js';
import { getProfileContextRevision, useProfileContextRevision } from '../lib/profile-context.js';
import { queryKeys } from '../lib/query-keys.js';
import {
  useWalletBalance,
  walletBalance,
  walletReadPacket,
  type WalletBalance,
} from '../hooks/useWalletBalance.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { toast } from '../lib/toast-api.js';
import { Skeleton, Alert, AlertDescription, Button, Input, Label } from '@barghsa/ui';
import { CustomerReceiptFields } from '../components/CustomerReceiptFields.js';
import { RecordEditorActions, recordEditorSurface } from '../components/RecordEditorLayout.js';
import { useWizardForm as useDraftForm } from '../hooks/useWizardForm.js';
import { useReceiptForm } from '../hooks/useReceiptForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { TransactionList } from '../components/WalletTransactionList.js';
import { Currency } from '../components/Currency.js';
import type { WalletPaymentReturn } from '../components/OnlinePaymentReturnPanel.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { t, type Locale } from '@barghsa/i18n/workspace';
import { Link, useBlocker } from '@tanstack/react-router';
import type { OnlineTopUpReview } from '@barghsa/shared/finance';
import type { BankReceiptTopUpReview } from '@barghsa/shared/finance';
import {
  parseBankReceiptTopUpAmountIrR,
  parseBankReceiptBankName,
  isValidWalletTopUpLimit,
} from '@barghsa/shared/finance/browser';
import type { OnlineTopUpActionError } from '../lib/online-topup-action.js';
import { useLocale } from '../hooks/useLocale.js';
import { normalizeIrrAmountDigits } from '../lib/invoice-bank-receipt-fields.js';
import { rememberWalletInvoiceReturn } from '../lib/wallet-invoice-return.js';
import { useMaintenance } from '../hooks/useMaintenance.js';
import { MaintenanceNotice } from '../components/MaintenanceNotice.js';
import { loadingText } from '@barghsa/i18n/loading-feedback';
import { tPublicMaintenance as tMaintenance } from '@barghsa/i18n/maintenance-public';

const OnlineTopUpReviewDialog = lazy(() => import('../components/OnlineTopUpReviewDialog.js'));
const OnlinePaymentReturnPanel = lazy(() =>
  import('../components/OnlinePaymentReturnPanel.js').then((module) => ({
    default: module.OnlinePaymentReturnPanel,
  }))
);
const BankReceiptTopUpReviewDialog = lazy(
  () => import('../components/BankReceiptTopUpReviewDialog.js')
);

/** Advertised per-transaction ceiling, or `null` when GET did not return a valid limit. */
function advertisedOnlineTopUpLimit(wallet: WalletBalance | null): number | null {
  if (!wallet || !isValidWalletTopUpLimit(wallet.onlineTopUpLimit)) return null;
  return wallet.onlineTopUpLimit;
}

type PageError =
  'no-profile' | 'load' | Exclude<OnlineTopUpActionError, 'invalid-amount' | 'limit-exceeded'>;

type ReceiptError = 'upload' | 'conflict' | 'maintenance' | 'generic' | 'unconfirmed';

function mapReceiptSubmitError(status: number): ReceiptError {
  if (status === 503) return 'maintenance';
  if (status === 409) return 'conflict';
  return 'generic';
}

function receiptErrorText(error: ReceiptError, locale: Locale) {
  return error === 'maintenance'
    ? tMaintenance('title', locale)
    : t(
        error === 'upload'
          ? 'wallet.page.receiptUploadError'
          : error === 'conflict'
            ? 'wallet.page.conflict'
            : error === 'unconfirmed'
              ? 'wallet.page.receiptUnconfirmed'
              : 'wallet.page.receiptGenericError',
        locale
      );
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
  topUpMethod?: 'online' | 'bank-receipt';
  backSearch?: Record<string, unknown>;
}
export function WalletPage(props: WalletPageProps = {}) {
  const revision = useProfileContextRevision();
  const actor = useAccountUser();
  return (
    <CustomerWalletPage key={JSON.stringify([actor, revision, props.topUpMethod])} {...props} />
  );
}
function WalletMovementGuard({ locked }: { locked: boolean }) {
  useBlocker({ shouldBlockFn: () => locked, enableBeforeUnload: false });
  return null;
}

function CustomerWalletPage({
  paymentReturn,
  returnInvoiceId,
  historyQuery,
  topUpMethod,
  backSearch,
}: WalletPageProps) {
  const actor = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const receiptFileInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (topUpMethod) heading.current?.focus({ preventScroll: true });
  }, [topUpMethod]);
  const locale = useLocale();
  const walletText = (key: string) => t(`wallet.page.${key}`, locale);
  const maintenance = useMaintenance('wallet_topup');
  const numbers = useNumberFormatting(locale);
  const isRtl = locale === 'fa';

  const {
    profileId,
    setProfileId,
    wallet,
    setWallet,
    loading,
    setLoading,
    error,
    setError,
    load,
    readWallet,
    loadRequest,
    mounted,
  } = useWalletBalance<PageError>(() => {
    setOnlineReview(null);
    setReceiptReview(null);
  });
  const readFinancial = useOwnedFinancialRead(actor, profileRevision, JSON.stringify([profileId]));
  const online = useDraftForm<{ amount: string }>(
    async () => {
      const { createOnlineTopUpSchema } = await import('../lib/wallet-top-up-form-schema.js');
      return createOnlineTopUpSchema(advertisedOnlineTopUpLimit(wallet), {
        invalid: walletText('invalidAmount'),
        limit: walletText('limitExceeded'),
      });
    },
    { amount: '' },
    walletText('loadError')
  );
  const [amountInput, setAmountInput] = online.field('amount');
  const invalidOnlineAmount = useActionFieldErrors(
    online.form,
    { amount: walletText('invalidAmount') },
    walletText('loadError')
  );
  const exceededOnlineAmount = useActionFieldErrors(
    online.form,
    { amount: walletText('limitExceeded') },
    walletText('loadError')
  );
  const onlinePending = useRef(false),
    receiptPending = useRef(false);
  const liveProfile = useRef(profileId);
  liveProfile.current = profileId;
  const [submitting, setSubmitting] = useState(false);
  const [onlineReview, setOnlineReview] = useState<OnlineTopUpReview | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const receipt = useReceiptForm('wallet', parseBankReceiptTopUpAmountIrR);
  const [receiptUploaded, setReceiptUploaded] = useState<{
    file: File;
    profileId: string;
    key: string;
  } | null>(null);
  const [receiptReview, setReceiptReview] = useState<BankReceiptTopUpReview | null>(null);
  const [receiptSubmitting, setReceiptSubmitting] = useState(false);
  const [receiptError, setReceiptError] = useState<ReceiptError | null>(null);
  const [receiptSuccess, setReceiptSuccess] = useState(false);
  const [receiptIdempotencyKey, setReceiptIdempotencyKey] = useState(() => crypto.randomUUID());

  const amountDigits = normalizeIrrAmountDigits(amountInput);
  const amountValue = amountDigits === '' ? null : Number(amountDigits);
  const tomanPreview =
    amountValue === null || !Number.isSafeInteger(amountValue)
      ? null
      : Math.round(amountValue / 10);

  const receiptAmountDigits = normalizeIrrAmountDigits(receipt.values.amount);
  const receiptAmountIrR = parseBankReceiptTopUpAmountIrR(receiptAmountDigits);
  const receiptTomanPreview = receiptAmountIrR === null ? null : receiptAmountIrR / 10n;

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
      const result = await loadOnlineTopUpReview(
        profileId,
        Number(values.amount),
        idempotencyKey,
        (path, init) => readFinancial(path, init, true, {})
      );
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
    if (
      result.error === 'limit-exceeded' ||
      result.error === 'invalid-amount' ||
      result.error === 'conflict'
    ) {
      setIdempotencyKey(crypto.randomUUID());
    }
    const limit = result.enforcedLimit;
    if (limit) {
      const { onlineTopUpLimit, configVersion } = limit;
      setWallet((prev) => (prev ? { ...prev, onlineTopUpLimit, configVersion } : prev));
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
      const { loadBankReceiptTopUpReview, uploadWalletReceiptAttachment } =
        await import('../lib/bank-receipt-topup-action.js');
      if (!current()) return;
      const attachmentKey =
        receiptUploaded?.file === selectedFile && receiptUploaded.profileId === profileId
          ? receiptUploaded.key
          : await uploadWalletReceiptAttachment(selectedFile, profileId);
      if (!current()) return;
      if (!attachmentKey) {
        setReceiptError('upload');
        return;
      }
      setReceiptUploaded({ file: selectedFile, profileId, key: attachmentKey });
      const bankName = parseBankReceiptBankName(values.bankName);
      const result = await loadBankReceiptTopUpReview(
        {
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
        },
        (path, init) => readFinancial(path, init, true, {})
      );
      if (!current()) return;
      if (result.kind === 'error') {
        const next = mapReceiptSubmitError(result.status);
        if (next === 'conflict') setReceiptIdempotencyKey(crypto.randomUUID());
        const fields = result.fields ?? [];
        if (receipt.applyServerErrors(fields)) {
          if (fields.includes('attachmentKey')) setReceiptUploaded(null);
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
    const current = () =>
      mounted.current &&
      getProfileContextRevision() === profileRevision &&
      liveProfile.current === receiptReview.data.profileId;
    if (!current()) return;
    receiptPending.current = true;
    setReceiptSubmitting(true);
    setReceiptError(null);
    const reportError = (reason: ReceiptError) => {
      setReceiptError(reason);
      toast.error(receiptErrorText(reason, locale));
    };
    try {
      const { submitReviewedBankReceiptTopUp } =
        await import('../lib/bank-receipt-topup-action.js');
      if (!current()) return;
      const result = await submitReviewedBankReceiptTopUp(receiptReview, receiptIdempotencyKey);
      if (!current()) return;
      if (result.kind === 'error') {
        setReceiptReview(null);
        const next =
          result.status >= 500 || (result.status >= 200 && result.status < 300)
            ? 'unconfirmed'
            : mapReceiptSubmitError(result.status);
        if (next === 'conflict') setReceiptIdempotencyKey(crypto.randomUUID());
        const fields = result.fields ?? [];
        if (receipt.applyServerErrors(fields)) {
          if (fields.includes('attachmentKey')) setReceiptUploaded(null);
        } else reportError(next);
        return;
      }
      setReceiptReview(null);
      setReceiptSuccess(true);
      toast.success(walletText('receiptSuccess'));
      setReceiptIdempotencyKey(crypto.randomUUID());
      receipt.form.reset({ ...receipt.form.getValues(), file: null });
      setReceiptUploaded(null);
      if (receiptFileInput.current) receiptFileInput.current.value = '';
      loadRequest.current?.abort();
      const refresh = new AbortController();
      loadRequest.current = refresh;
      const ownsRead = () =>
        mounted.current && loadRequest.current === refresh && !refresh.signal.aborted;
      const key = queryKeys.wallet.balance({
        context: 'customer',
        ownerId: receiptReview.data.profileId,
        accountId: actor,
        revision: profileRevision,
      });
      try {
        const walletRes = await readWallet(key, refresh.signal, (signal) =>
          walletReadPacket(`/api/wallet/${receiptReview.data.profileId}`, signal)
        );
        if (!current() || !ownsRead()) return;
        if (!walletRes.ok) {
          if ([401, 403, 404].includes(walletRes.status)) {
            setWallet(null);
            setProfileId(null);
            setOnlineReview(null);
          }
          setError('load');
          return;
        }
        const nextWallet = walletBalance(walletRes.data);
        if (!nextWallet) {
          setWallet(null);
          setError('load');
          return;
        }
        setWallet(nextWallet);
      } catch {
        if (current() && ownsRead()) setError('load');
      } finally {
        if (mounted.current && loadRequest.current === refresh) {
          setLoading(false);
          loadRequest.current = null;
        }
      }
    } catch {
      if (current()) {
        setReceiptReview(null);
        reportError('unconfirmed');
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
    error &&
    (error === 'maintenance'
      ? tMaintenance('title', locale)
      : walletText(
          error === 'no-profile'
            ? 'noProfile'
            : error === 'gateway'
              ? 'gatewayError'
              : error === 'conflict'
                ? 'conflict'
                : 'loadError'
        ));

  const receiptErrorMessage = receiptError && receiptErrorText(receiptError, locale);
  const reviewLoading = <p role="status">{walletText('reviewLoading')}</p>;
  const tomanPreviewText = (amount: number | bigint) =>
    walletText('tomanPreview').replace('{amount}', numbers.irrDigits(amount));

  return (
    <div
      className={topUpMethod ? 'mx-auto max-w-2xl space-y-4' : 'mx-auto max-w-4xl space-y-6'}
      dir={isRtl ? 'rtl' : 'ltr'}
      data-testid="wallet-page"
    >
      {topUpMethod && <WalletMovementGuard locked={onlineBusy || receiptBusy} />}
      <header className="space-y-2">
        {topUpMethod && (
          <Link
            to="/wallet"
            search={backSearch ?? {}}
            className="touch-action text-sm text-primary underline underline-offset-4"
          >
            {walletText('backToWallet')}
          </Link>
        )}
        <h1
          ref={heading}
          tabIndex={topUpMethod ? -1 : undefined}
          className="text-2xl font-semibold outline-none sm:text-3xl"
        >
          {walletText(
            topUpMethod === 'online'
              ? 'onlineTitle'
              : topUpMethod === 'bank-receipt'
                ? 'receiptTitle'
                : 'title'
          )}
        </h1>
        {!topUpMethod && <p className="text-sm text-muted-foreground">{walletText('subtitle')}</p>}
        {returnInvoiceId && (
          <a
            className="mt-3 inline-block text-sm font-medium text-primary underline"
            href={`/invoices/${encodeURIComponent(returnInvoiceId)}`}
          >
            {walletText('returnToInvoice')}
          </a>
        )}
      </header>

      {paymentReturn && (
        <Suspense fallback={reviewLoading}>
          <OnlinePaymentReturnPanel
            key={`${paymentReturn.orderId}:${paymentReturn.authority}`}
            payment={paymentReturn}
            locale={locale}
            onConfirmed={() => void load()}
          />
        </Suspense>
      )}

      {loading ? (
        <div role="status" aria-label={loadingText('loading', locale)}>
          <Skeleton className="h-40 rounded-lg" data-testid="wallet-loading" />
        </div>
      ) : (
        <div
          className={
            topUpMethod
              ? 'space-y-3'
              : 'grid grid-cols-1 items-start gap-6 lg:grid-cols-2 [&>:not(form)]:col-span-full'
          }
          data-testid="wallet-loaded"
        >
          {wallet && (
            <section
              className={
                topUpMethod
                  ? 'flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-xl border bg-muted/35 px-4 py-3'
                  : 'flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-xl border bg-card px-4 py-4 sm:px-6'
              }
            >
              <p className="text-sm text-muted-foreground">{walletText('currentBalance')}</p>
              <p className="min-w-0 text-base font-semibold" data-testid="wallet-balance">
                {wallet.currency === 'IRR' ? (
                  <Currency amount={wallet.balance} showToman locale={locale} />
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

          {profileId && !maintenance?.active && topUpMethod !== 'bank-receipt' && (
            <form noValidate onSubmit={handleSubmit} className={recordEditorSurface}>
              <div className="min-w-0 space-y-3 px-4 py-4 sm:px-6">
                {(validationError ||
                  (errorMessage && error !== 'load' && error !== 'no-profile')) && (
                  <Alert variant="destructive" data-testid="wallet-error">
                    <AlertDescription>{errorMessage || validationError}</AlertDescription>
                  </Alert>
                )}
                {!topUpMethod && (
                  <h2 className="text-base font-semibold">{walletText('onlineTitle')}</h2>
                )}
                <div className="min-w-0 space-y-1">
                  <Label htmlFor="top-up-amount">{walletText('amountLabel')}</Label>
                  <Input
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
                    aria-describedby={
                      online.errors.amount
                        ? `top-up-amount-hint ${online.errorId('amount')}`
                        : 'top-up-amount-hint'
                    }
                    onChange={(event) =>
                      setAmountInput(normalizeIrrAmountDigits(event.target.value))
                    }
                    className="sm:max-w-xs"
                  />
                  <p id="top-up-amount-hint" className="text-xs text-muted-foreground">
                    {advertisedLimit === 0
                      ? walletText('amountHintBlocked')
                      : walletText('amountHint').replace(
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
                </div>
              </div>
              <RecordEditorActions
                secondary={
                  tomanPreview === null ? undefined : (
                    <p className="text-sm text-muted-foreground" data-testid="wallet-toman">
                      {tomanPreviewText(tomanPreview)}
                    </p>
                  )
                }
              >
                <Button
                  type="submit"
                  data-testid="wallet-submit"
                  disabled={onlineSubmitDisabled}
                  aria-busy={onlineBusy || undefined}
                >
                  {onlineBusy
                    ? walletText(onlineReview ? 'submitting' : 'reviewLoading')
                    : walletText('submit')}
                </Button>
              </RecordEditorActions>
            </form>
          )}

          {profileId && !maintenance?.active && topUpMethod !== 'online' && (
            <form
              noValidate
              onSubmit={handleReceiptSubmit}
              className={recordEditorSurface}
              data-testid="wallet-receipt-form"
            >
              <div className="min-w-0 space-y-3 px-4 py-4 sm:px-6">
                <div className="space-y-1">
                  {!topUpMethod && (
                    <h2 className="text-base font-semibold">{walletText('receiptTitle')}</h2>
                  )}
                  <p className="text-sm text-muted-foreground">{walletText('receiptSubtitle')}</p>
                </div>
                {receiptSuccess && (
                  <div
                    role="status"
                    data-testid="wallet-receipt-success"
                    className="rounded-lg border border-success/20 bg-success-soft p-3 text-sm text-success"
                  >
                    {walletText('receiptSuccess')}
                  </div>
                )}
                {(receiptErrorMessage || receiptValidationError) && (
                  <Alert variant="destructive" data-testid="wallet-receipt-error">
                    <AlertDescription>
                      {receiptErrorMessage || receiptValidationError}
                    </AlertDescription>
                  </Alert>
                )}
                <CustomerReceiptFields
                  kind="wallet"
                  draft={receipt}
                  disabled={receiptLocked}
                  maxDate={new Date().toISOString().slice(0, 10)}
                  fileInput={receiptFileInput}
                  onEdit={(name) => {
                    if (name !== 'file') return;
                    setReceiptUploaded(null);
                    if (receiptError === 'upload') setReceiptError(null);
                  }}
                  amountHint={
                    receiptTomanPreview === null ? null : (
                      <p data-testid="wallet-receipt-toman">
                        {tomanPreviewText(receiptTomanPreview)}
                      </p>
                    )
                  }
                />
              </div>
              <RecordEditorActions className="max-sm:justify-start">
                <Button
                  type="submit"
                  data-testid="wallet-receipt-submit"
                  disabled={receiptLocked}
                  aria-busy={receiptBusy || undefined}
                >
                  {receiptBusy ? walletText('receiptSubmitting') : walletText('receiptSubmit')}
                </Button>
              </RecordEditorActions>
            </form>
          )}

          {profileId && !topUpMethod && (
            <TransactionList
              key={`${profileId}-${receiptSuccess}`}
              profileId={profileId}
              locale={locale}
              {...(historyQuery ? { binding: historyQuery } : {})}
            />
          )}

          {onlineReview ? (
            <Suspense fallback={reviewLoading}>
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
            <Suspense fallback={reviewLoading}>
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
              {walletText('retry')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
