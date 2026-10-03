import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription } from '@barghsa/ui';
import { FormField } from '@barghsa/ui/form';
import { Loader2 } from 'lucide-react';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useReceiptForm } from '../hooks/useReceiptForm.js';
import { t } from '@barghsa/i18n/app';
import type { InvoiceBankReceiptSubmissionReview } from '@barghsa/shared/finance';
import {
  INVOICE_BANK_RECEIPT_FILE_ACCEPT,
  parseInvoiceBankReceiptAmountIrR,
} from '@barghsa/shared/finance';
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

interface InvoiceBankReceiptUploadFormProps {
  invoiceId: string;
  onSubmitted?: () => Promise<void>;
}

const InvoiceBankReceiptSubmissionReviewDialog = lazy(
  () => import('../components/InvoiceBankReceiptSubmissionReviewDialog.js')
);

const ERROR_I18N: Record<InvoiceReceiptError, string> = {
  'invalid-amount': 'invoices.details.receiptInvalidAmount',
  'invalid-date': 'invoices.details.receiptInvalidDate',
  'invalid-payer-ref': 'invoices.details.receiptInvalidPayerRef',
  'invalid-file': 'invoices.details.receiptInvalidFile',
  upload: 'invoices.details.receiptUploadError',
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
function InvoiceReceiptForm({ invoiceId, onSubmitted }: InvoiceBankReceiptUploadFormProps) {
  const locale = useLocale();
  const fileInput = useRef<HTMLInputElement>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const draft = useReceiptForm('invoice', parseInvoiceBankReceiptAmountIrR);
  const [amountInput, setAmountInput] = draft.field('amount');
  const [paymentDate, setPaymentDate] = draft.field('paymentDate');
  const [payerReference, setPayerReference] = draft.field('payerReference');
  const [bankName, setBankName] = draft.field('bankName');
  const [customerNote, setCustomerNote] = draft.field('customerNote');
  const [, setFile] = draft.field('file');
  const mounted = useRef(false);
  const pending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [uploaded, setUploaded] = useState<{ file: File; profileId: string; key: string } | null>(
    null
  );
  const [review, setReview] = useState<InvoiceBankReceiptSubmissionReview | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<InvoiceReceiptError | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchActiveProfileId().then((id) => {
      if (!cancelled) setProfileId(id);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = draft.form.handleSubmit(async (values) => {
    if (pending.current || review || !mounted.current) return;
    if (!profileId) {
      setError('no-profile');
      return;
    }
    const selectedFile = values.file;
    if (!selectedFile) return;
    pending.current = true;
    setSubmitting(true);
    setError(null);
    setSuccess(false);
    try {
      const attachmentKey =
        uploaded?.file === selectedFile && uploaded.profileId === profileId
          ? uploaded.key
          : await uploadInvoiceReceiptAttachment(selectedFile, profileId);
      if (!mounted.current) return;
      if (!attachmentKey) {
        setError('upload');
        return;
      }
      setUploaded({ file: selectedFile, profileId, key: attachmentKey });
      const { loadInvoiceBankReceiptSubmissionReview } =
        await import('../lib/invoice-bank-receipt-review-action.js');
      const result = await loadInvoiceBankReceiptSubmissionReview({
        invoiceId,
        amountIrR: parseInvoiceBankReceiptAmountIrR(
          normalizeIrrAmountDigits(values.amount)
        )!.toString(),
        paymentDate: values.paymentDate,
        payerReference: values.payerReference.trim(),
        bankName: values.bankName.trim() || null,
        attachmentKey,
        customerNote: values.customerNote.trim() || null,
      });
      if (!mounted.current) return;
      if (result.kind === 'error') {
        if (draft.applyServerErrors(result.fields)) {
          if (result.fields?.includes('attachmentKey')) setUploaded(null);
        } else setError(mapInvoiceReceiptSubmitError(result.status));
        return;
      }
      setReview(result.review);
    } catch {
      if (mounted.current) setError('upload');
    } finally {
      if (mounted.current) {
        pending.current = false;
        setSubmitting(false);
      }
    }
  });

  async function confirmSubmission() {
    if (!review || pending.current || !mounted.current) return;
    pending.current = true;
    setSubmitting(true);
    setError(null);
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
      if (!mounted.current) return;
      if (!result.ok) {
        setReview(null);
        if (draft.applyServerErrors(result.fields)) {
          if (result.fields?.includes('attachmentKey')) setUploaded(null);
        } else setError(mapInvoiceReceiptSubmitError(result.status));
        return;
      }
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
      if (mounted.current) {
        setReview(null);
        setError('generic');
      }
    } finally {
      if (mounted.current) {
        pending.current = false;
        setSubmitting(false);
      }
    }
  }

  const busy = submitting || draft.form.formState.isSubmitting;
  const locked = busy || !!review;
  const errorMessage =
    (error === null ? null : t(ERROR_I18N[error], locale)) ||
    draft.errors.root?.validation?.message;

  return (
    <>
      <form
        noValidate
        onSubmit={handleSubmit}
        className="space-y-4 rounded-lg bg-card text-card-foreground p-6 shadow-sm"
        data-testid="invoice-receipt-form"
      >
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {t('invoices.details.receiptTitle', locale)}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('invoices.details.receiptSubtitle', locale)}
          </p>
        </div>

        {success && (
          <div
            role="status"
            data-testid="invoice-receipt-success"
            className="rounded-lg border border-success/20 bg-success-soft p-3 text-sm text-success"
          >
            {t('invoices.details.receiptSuccess', locale)}
          </div>
        )}

        {errorMessage && (
          <Alert variant="destructive" data-testid="invoice-receipt-error">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        <div>
          <label
            htmlFor="invoice-receipt-amount"
            className="block text-sm font-medium text-foreground"
          >
            {t('invoices.details.receiptAmountLabel', locale)}
          </label>
          <input
            {...draft.bind('amount')}
            id="invoice-receipt-amount"
            data-testid="invoice-receipt-amount"
            name="amount"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            dir="ltr"
            value={amountInput}
            disabled={locked}
            onChange={(event) => {
              setAmountInput(normalizeIrrAmountDigits(event.target.value));
              if (error === 'invalid-amount') setError(null);
            }}
            className="mt-1 h-10 w-full rounded-lg border border-input px-3 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          {draft.errors.amount && (
            <p id={draft.errorId('amount')} role="alert" className="text-sm text-destructive">
              {draft.errors.amount.message}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="invoice-receipt-date"
            className="block text-sm font-medium text-foreground"
          >
            {t('invoices.details.receiptDateLabel', locale)}
          </label>
          <input
            {...draft.bind('paymentDate')}
            id="invoice-receipt-date"
            data-testid="invoice-receipt-date"
            name="paymentDate"
            type="date"
            max={utcTodayIso()}
            value={paymentDate}
            disabled={locked}
            onChange={(event) => {
              setPaymentDate(event.target.value);
              if (error === 'invalid-date') setError(null);
            }}
            className="mt-1 h-10 w-full rounded-lg border border-input px-3 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          {draft.errors.paymentDate && (
            <p id={draft.errorId('paymentDate')} role="alert" className="text-sm text-destructive">
              {draft.errors.paymentDate.message}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="invoice-receipt-payer-ref"
            className="block text-sm font-medium text-foreground"
          >
            {t('invoices.details.receiptPayerRefLabel', locale)}
          </label>
          <input
            {...draft.bind('payerReference')}
            id="invoice-receipt-payer-ref"
            data-testid="invoice-receipt-payer-ref"
            name="payerReference"
            type="text"
            autoComplete="off"
            maxLength={128}
            value={payerReference}
            disabled={locked}
            onChange={(event) => {
              setPayerReference(event.target.value);
              if (error === 'invalid-payer-ref') setError(null);
            }}
            className="mt-1 h-10 w-full rounded-lg border border-input px-3 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          {draft.errors.payerReference && (
            <p
              id={draft.errorId('payerReference')}
              role="alert"
              className="text-sm text-destructive"
            >
              {draft.errors.payerReference.message}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="invoice-receipt-bank-name"
            className="block text-sm font-medium text-foreground"
          >
            {t('invoices.details.receiptBankNameLabel', locale)}
          </label>
          <input
            {...draft.bind('bankName')}
            id="invoice-receipt-bank-name"
            data-testid="invoice-receipt-bank-name"
            name="bankName"
            type="text"
            autoComplete="off"
            maxLength={128}
            value={bankName}
            disabled={locked}
            onChange={(event) => setBankName(event.target.value)}
            className="mt-1 h-10 w-full rounded-lg border border-input px-3 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          {draft.errors.bankName && (
            <p id={draft.errorId('bankName')} role="alert" className="text-sm text-destructive">
              {draft.errors.bankName.message}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="invoice-receipt-file"
            className="block text-sm font-medium text-foreground"
          >
            {t('invoices.details.receiptFileLabel', locale)}
          </label>
          <FormField
            control={draft.form.control}
            name="file"
            render={({ field }) => (
              <input
                ref={(element) => {
                  field.ref(element);
                  fileInput.current = element;
                }}
                onBlur={field.onBlur}
                aria-invalid={!!draft.errors.file || undefined}
                id="invoice-receipt-file"
                data-testid="invoice-receipt-file"
                name="receiptFile"
                type="file"
                accept={INVOICE_BANK_RECEIPT_FILE_ACCEPT}
                disabled={locked}
                aria-describedby={[
                  'invoice-receipt-file-hint',
                  draft.errors.file ? draft.errorId('file') : null,
                ]
                  .filter(Boolean)
                  .join(' ')}
                onChange={(event) => {
                  const next = event.target.files?.[0] ?? null;
                  setFile(next);
                  setUploaded(null);
                  if (error === 'invalid-file' || error === 'upload') setError(null);
                }}
                className="mt-1 block w-full text-sm text-muted-foreground file:me-4 file:rounded-lg file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground"
              />
            )}
          />
          <p id="invoice-receipt-file-hint" className="mt-2 text-sm text-muted-foreground">
            {t('invoices.details.receiptFileHint', locale)}
          </p>
          {draft.errors.file && (
            <p id={draft.errorId('file')} role="alert" className="text-sm text-destructive">
              {draft.errors.file.message}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="invoice-receipt-note"
            className="block text-sm font-medium text-foreground"
          >
            {t('invoices.details.receiptNoteLabel', locale)}
          </label>
          <textarea
            {...draft.bind('customerNote')}
            id="invoice-receipt-note"
            data-testid="invoice-receipt-note"
            name="customerNote"
            rows={3}
            maxLength={2000}
            value={customerNote}
            disabled={locked}
            onChange={(event) => setCustomerNote(event.target.value)}
            className="mt-1 w-full rounded-lg border border-input px-3 py-2 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          {draft.errors.customerNote && (
            <p id={draft.errorId('customerNote')} role="alert" className="text-sm text-destructive">
              {draft.errors.customerNote.message}
            </p>
          )}
        </div>

        <button
          type="submit"
          data-testid="invoice-receipt-submit"
          disabled={locked}
          aria-busy={busy || undefined}
          className="w-full rounded-lg border border-primary bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {busy && (
            <Loader2
              aria-hidden="true"
              className="me-2 inline size-4 animate-spin motion-reduce:animate-none"
            />
          )}
          {busy
            ? t('invoices.details.receiptSubmitting', locale)
            : t('invoices.details.receiptSubmit', locale)}
        </button>
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
