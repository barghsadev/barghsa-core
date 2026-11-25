import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription, Button, LoadingStatus } from '@barghsa/ui';
import { CustomerReceiptFields } from '../components/CustomerReceiptFields.js';
import { RecordEditorActions, recordEditorSurface } from '../components/RecordEditorLayout.js';
import { RecordCommandGuard } from '../components/RecordCommandGuard.js';
import { getProfileContextRevision, useProfileContextRevision } from '../lib/profile-context.js';
import { useCommandFeedback } from '../hooks/useCommandFeedback.js';
import { useReceiptForm } from '../hooks/useReceiptForm.js';
import { readWithDeadline } from '../lib/server-query-client.js';
import { t } from '@barghsa/i18n/app';
import { confirmationText } from '@barghsa/i18n/confirmation';
import type { InvoiceBankReceiptSubmissionReview } from '@barghsa/shared/finance';
import { parseInvoiceBankReceiptAmountIrR } from '@barghsa/shared/finance';
import { useLocale } from '../hooks/useLocale.js';
import {
  uploadInvoiceReceiptAttachment,
  fetchActiveProfileId,
  mapInvoiceReceiptSubmitError,
  normalizeIrrAmountDigits,
  submitInvoiceBankReceipt,
  utcTodayIso,
  type InvoiceReceiptError,
} from '../lib/invoice-bank-receipt-upload.js';

export interface InvoiceBankReceiptUploadFormProps {
  invoiceId: string;
  onSubmitted?: () => Promise<void>;
  recordPage?: boolean;
}

const InvoiceBankReceiptSubmissionReviewDialog = lazy(
  () => import('../components/InvoiceBankReceiptSubmissionReviewDialog.js')
);

const ERROR_I18N: Record<InvoiceReceiptError | 'review', string> = {
  'invalid-amount': 'invoices.details.receiptInvalidAmount',
  'invalid-date': 'invoices.details.receiptInvalidDate',
  'invalid-payer-ref': 'invoices.details.receiptInvalidPayerRef',
  'invalid-file': 'invoices.details.receiptInvalidFile',
  upload: 'invoices.details.receiptUploadError',
  review: 'invoices.details.receiptReviewFailed',
  conflict: 'invoices.details.receiptConflict',
  'no-profile': 'invoices.details.receiptNoProfile',
  generic: 'invoices.details.receiptGenericError',
};

/**
 * Customer invoice bank-receipt upload form (T-04.3.01.02).
 *
 * Validates a positive amount and allowed file type/size in the browser,
 * uploads the scan, then creates a Submitted receipt. Settlement waits
 * for finance confirmation.
 */
export function InvoiceBankReceiptUploadForm(props: InvoiceBankReceiptUploadFormProps) {
  const revision = useProfileContextRevision();
  return <InvoiceReceiptForm key={`${props.invoiceId}:${revision}`} {...props} />;
}
function InvoiceReceiptForm({
  invoiceId,
  onSubmitted,
  recordPage,
}: InvoiceBankReceiptUploadFormProps) {
  const locale = useLocale();
  const revision = useProfileContextRevision();
  const fileInput = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState<
    { status: 'loading' | 'failed' } | { status: 'loaded'; id: string | null }
  >({ status: 'loading' });
  const [profileAttempt, setProfileAttempt] = useState(0);
  const profileId = profile.status === 'loaded' ? profile.id : null;
  const draft = useReceiptForm('invoice', parseInvoiceBankReceiptAmountIrR);
  const mounted = useRef(false);
  const pending = useRef(false);
  const previewRequest = useRef<AbortController | null>(null);
  const isCurrent = () => mounted.current && getProfileContextRevision() === revision;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      previewRequest.current?.abort();
    };
  }, []);
  const [uploaded, setUploaded] = useState<{ file: File; profileId: string; key: string } | null>(
    null
  );
  const [review, setReview] = useState<InvoiceBankReceiptSubmissionReview | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<InvoiceReceiptError | 'review' | 'unconfirmed' | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const request = new AbortController();
    const current = () => !request.signal.aborted && getProfileContextRevision() === revision;
    void readWithDeadline(request.signal, fetchActiveProfileId).then(
      (id) => {
        if (current()) setProfile({ status: 'loaded', id });
      },
      () => {
        if (current()) setProfile({ status: 'failed' });
      }
    );
    return () => request.abort();
  }, [profileAttempt, revision]);

  const handleSubmit = draft.form.handleSubmit(async (values) => {
    if (pending.current || review || !isCurrent() || !profileId) return;
    const selectedFile = values.file;
    if (!selectedFile) return;
    pending.current = true;
    const request = new AbortController();
    previewRequest.current = request;
    const current = () => isCurrent() && !request.signal.aborted;
    setSubmitting(true);
    setError(null);
    setSuccess(false);
    let failure: 'upload' | 'review' = 'upload';
    try {
      const attachmentKey =
        uploaded?.file === selectedFile && uploaded.profileId === profileId
          ? uploaded.key
          : await uploadInvoiceReceiptAttachment(selectedFile, profileId, request.signal);
      if (!current()) return;
      if (!attachmentKey) {
        setError('upload');
        return;
      }
      setUploaded({ file: selectedFile, profileId, key: attachmentKey });
      failure = 'review';
      const { loadInvoiceBankReceiptSubmissionReview } =
        await import('../lib/invoice-bank-receipt-review-action.js');
      if (!current()) return;
      const result = await readWithDeadline(request.signal, (signal) =>
        loadInvoiceBankReceiptSubmissionReview(
          {
            invoiceId,
            profileId,
            amountIrR: parseInvoiceBankReceiptAmountIrR(
              normalizeIrrAmountDigits(values.amount)
            )!.toString(),
            paymentDate: values.paymentDate,
            payerReference: values.payerReference.trim(),
            bankName: values.bankName.trim() || null,
            attachmentKey,
            customerNote: values.customerNote.trim() || null,
          },
          signal
        )
      );
      if (!current()) return;
      if (result.kind === 'error') {
        const fields = result.fields ?? [];
        if (draft.applyServerErrors(fields)) {
          if (fields.includes('attachmentKey')) setUploaded(null);
        } else
          setError(result.status >= 500 ? 'review' : mapInvoiceReceiptSubmitError(result.status));
        return;
      }
      setReview(result.review);
    } catch {
      if (current()) setError(failure);
    } finally {
      if (current()) {
        previewRequest.current = null;
        pending.current = false;
        setSubmitting(false);
      }
    }
  });

  async function confirmSubmission() {
    if (!review || pending.current || !isCurrent()) return;
    pending.current = true;
    setSubmitting(true);
    setError(null);
    let confirmed = false;
    try {
      const result = await submitInvoiceBankReceipt({
        invoiceId: review.data.invoiceId,
        amountIrR: BigInt(review.data.amountIrR),
        paymentDate: review.data.paymentDate,
        payerReference: review.data.payerReference,
        ...(review.data.bankName ? { bankName: review.data.bankName } : {}),
        attachmentKey: review.data.attachmentKey,
        ...(review.data.customerNote ? { customerNote: review.data.customerNote } : {}),
        expectedReviewHash: review.hash,
      });
      if (!isCurrent()) return;
      if (!result.ok) {
        setReview(null);
        const fields = result.fields ?? [];
        if (draft.applyServerErrors(fields)) {
          if (fields.includes('attachmentKey')) setUploaded(null);
        } else {
          setError(
            result.status >= 500 || (result.status >= 200 && result.status < 300)
              ? 'unconfirmed'
              : mapInvoiceReceiptSubmitError(result.status)
          );
        }
        return;
      }
      confirmed = true;
      setReview(null);
      setSuccess(true);
      draft.form.reset({
        amount: '',
        paymentDate: review.data.paymentDate,
        payerReference: '',
        bankName: '',
        customerNote: '',
        file: null,
      });
      setUploaded(null);
      if (fileInput.current) fileInput.current.value = '';
      await onSubmitted?.();
    } catch {
      if (isCurrent() && !confirmed) {
        setReview(null);
        setError('unconfirmed');
      }
    } finally {
      if (isCurrent()) {
        pending.current = false;
        setSubmitting(false);
      }
    }
  }

  const busy = submitting || draft.form.formState.isSubmitting;
  const locked = busy || !!review;
  const commandError =
    error === 'unconfirmed'
      ? confirmationText('unconfirmed', locale)
      : error && t(ERROR_I18N[error], locale);
  const successMessage = success ? t('invoices.details.receiptSuccess', locale) : null;
  useCommandFeedback({ success: successMessage, error: commandError, operation: invoiceId });
  const errorMessage = commandError || draft.errors.root?.validation?.message;

  return (
    <>
      {recordPage && (
        <RecordCommandGuard blocked={() => pending.current || draft.form.isSubmissionPending()} />
      )}
      <form
        noValidate
        onSubmit={handleSubmit}
        className={recordEditorSurface}
        data-testid="invoice-receipt-form"
        aria-label={t('invoices.details.receiptTitle', locale)}
      >
        <div className="min-w-0 space-y-3 px-4 py-4 sm:px-6">
          {!recordPage && (
            <div className="space-y-1">
              <h2 className="text-base font-semibold">
                {t('invoices.details.receiptTitle', locale)}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t('invoices.details.receiptSubtitle', locale)}
              </p>
            </div>
          )}

          {profile.status === 'loading' && (
            <LoadingStatus>{t('invoices.details.receiptProfileLoading', locale)}</LoadingStatus>
          )}
          {!profileId && profile.status !== 'loading' && (
            <Alert variant="destructive" data-testid="invoice-receipt-profile-error">
              <AlertDescription>
                {t(
                  profile.status === 'failed'
                    ? 'invoices.details.receiptProfileUnavailable'
                    : 'invoices.details.receiptNoProfile',
                  locale
                )}
              </AlertDescription>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setProfile({ status: 'loading' });
                  setProfileAttempt((attempt) => attempt + 1);
                }}
              >
                {t('dashboard.profile.retry', locale)}
              </Button>
            </Alert>
          )}

          {successMessage && (
            <div
              role="status"
              data-testid="invoice-receipt-success"
              className="rounded-lg border border-success/20 bg-success-soft p-3 text-sm text-success"
            >
              {successMessage}
            </div>
          )}

          {errorMessage && (
            <Alert variant="destructive" data-testid="invoice-receipt-error">
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          <CustomerReceiptFields
            kind="invoice"
            draft={draft}
            disabled={locked}
            maxDate={utcTodayIso()}
            fileInput={fileInput}
            onEdit={(name) => {
              if (name === 'file') setUploaded(null);
              if (
                (name === 'amount' && error === 'invalid-amount') ||
                (name === 'paymentDate' && error === 'invalid-date') ||
                (name === 'payerReference' && error === 'invalid-payer-ref') ||
                (name === 'file' && (error === 'invalid-file' || error === 'upload'))
              )
                setError(null);
            }}
          />
        </div>
        <RecordEditorActions className="max-sm:justify-start">
          <Button
            type="submit"
            data-testid="invoice-receipt-submit"
            disabled={locked || !profileId}
            loading={busy}
          >
            {busy
              ? t('invoices.details.receiptSubmitting', locale)
              : t('invoices.details.receiptSubmit', locale)}
          </Button>
        </RecordEditorActions>
      </form>
      {review ? (
        <Suspense
          fallback={<p role="status">{t('invoices.details.receiptReviewLoading', locale)}</p>}
        >
          <InvoiceBankReceiptSubmissionReviewDialog
            review={review}
            locale={locale}
            loading={busy}
            onCancel={() => setReview(null)}
            onConfirm={() => void confirmSubmission()}
          />
        </Suspense>
      ) : null}
    </>
  );
}
