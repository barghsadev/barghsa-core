import { useEffect, useState, type FormEvent } from 'react'
import { t } from '@barghsa/i18n'
import {
  INVOICE_BANK_RECEIPT_FILE_ACCEPT,
  parseInvoiceBankReceiptAmountIrR,
} from '@barghsa/shared/finance'
import { useLocale } from '../hooks/useLocale.js'
import {
  fetchActiveProfileId,
  isAllowedInvoiceReceiptFile,
  mapInvoiceReceiptSubmitError,
  normalizeIrrAmountDigits,
  submitInvoiceBankReceipt,
  uploadInvoiceReceiptAttachment,
  utcTodayIso,
  type InvoiceReceiptError,
} from '../lib/invoice-bank-receipt-upload.js'

interface InvoiceBankReceiptUploadFormProps {
  invoiceId: string
}

const ERROR_I18N: Record<InvoiceReceiptError, string> = {
  'invalid-amount': 'invoices.details.receiptInvalidAmount',
  'invalid-date': 'invoices.details.receiptInvalidDate',
  'invalid-payer-ref': 'invoices.details.receiptInvalidPayerRef',
  'invalid-file': 'invoices.details.receiptInvalidFile',
  upload: 'invoices.details.receiptUploadError',
  conflict: 'invoices.details.receiptConflict',
  'no-profile': 'invoices.details.receiptNoProfile',
  generic: 'invoices.details.receiptGenericError',
}

/**
 * Customer invoice bank-receipt upload form (T-04.3.01.02).
 *
 * Validates a positive amount and allowed file type/size in the browser,
 * uploads the scan, then creates a Submitted receipt. Settlement waits
 * for finance confirmation.
 */
export function InvoiceBankReceiptUploadForm({ invoiceId }: InvoiceBankReceiptUploadFormProps) {
  const locale = useLocale()
  const [profileId, setProfileId] = useState<string | null>(null)
  const [amountInput, setAmountInput] = useState('')
  const [paymentDate, setPaymentDate] = useState('')
  const [payerReference, setPayerReference] = useState('')
  const [customerNote, setCustomerNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<InvoiceReceiptError | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchActiveProfileId().then((id) => {
      if (!cancelled) setProfileId(id)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const amountIrR = parseInvoiceBankReceiptAmountIrR(normalizeIrrAmountDigits(amountInput))
    if (amountIrR === null) {
      setError('invalid-amount')
      setSuccess(false)
      return
    }
    const today = utcTodayIso()
    if (!paymentDate || paymentDate > today) {
      setError('invalid-date')
      setSuccess(false)
      return
    }
    if (payerReference.trim().length === 0) {
      setError('invalid-payer-ref')
      setSuccess(false)
      return
    }
    if (!file || !isAllowedInvoiceReceiptFile(file)) {
      setError('invalid-file')
      setSuccess(false)
      return
    }
    if (!profileId) {
      setError('no-profile')
      setSuccess(false)
      return
    }

    setSubmitting(true)
    setError(null)
    setSuccess(false)
    try {
      const attachmentKey = await uploadInvoiceReceiptAttachment(file, profileId)
      if (!attachmentKey) {
        setError('upload')
        return
      }
      const result = await submitInvoiceBankReceipt({
        invoiceId,
        amountIrR,
        paymentDate,
        payerReference: payerReference.trim(),
        attachmentKey,
        ...(customerNote.trim() === '' ? {} : { customerNote: customerNote.trim() }),
      })
      if (!result.ok) {
        setError(mapInvoiceReceiptSubmitError(result.status))
        return
      }
      setSuccess(true)
      setFile(null)
      setAmountInput('')
      setPayerReference('')
      setCustomerNote('')
    } catch {
      setError('upload')
    } finally {
      setSubmitting(false)
    }
  }

  const errorMessage = error === null ? null : t(ERROR_I18N[error], locale)

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-lg bg-white p-6 shadow-sm"
      data-testid="invoice-receipt-form"
    >
      <div>
        <h2 className="text-lg font-semibold text-gray-900">
          {t('invoices.details.receiptTitle', locale)}
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          {t('invoices.details.receiptSubtitle', locale)}
        </p>
      </div>

      {success && (
        <div
          role="status"
          data-testid="invoice-receipt-success"
          className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800"
        >
          {t('invoices.details.receiptSuccess', locale)}
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          data-testid="invoice-receipt-error"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {errorMessage}
        </div>
      )}

      <div>
        <label htmlFor="invoice-receipt-amount" className="block text-sm font-medium text-gray-700">
          {t('invoices.details.receiptAmountLabel', locale)}
        </label>
        <input
          id="invoice-receipt-amount"
          data-testid="invoice-receipt-amount"
          name="amount"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          dir="ltr"
          value={amountInput}
          disabled={submitting}
          aria-invalid={error === 'invalid-amount'}
          onChange={(event) => {
            setAmountInput(normalizeIrrAmountDigits(event.target.value))
            if (error === 'invalid-amount') setError(null)
          }}
          className="mt-1 h-10 w-full rounded-lg border border-gray-300 px-3 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <div>
        <label htmlFor="invoice-receipt-date" className="block text-sm font-medium text-gray-700">
          {t('invoices.details.receiptDateLabel', locale)}
        </label>
        <input
          id="invoice-receipt-date"
          data-testid="invoice-receipt-date"
          name="paymentDate"
          type="date"
          max={utcTodayIso()}
          value={paymentDate}
          disabled={submitting}
          aria-invalid={error === 'invalid-date'}
          onChange={(event) => {
            setPaymentDate(event.target.value)
            if (error === 'invalid-date') setError(null)
          }}
          className="mt-1 h-10 w-full rounded-lg border border-gray-300 px-3 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <div>
        <label
          htmlFor="invoice-receipt-payer-ref"
          className="block text-sm font-medium text-gray-700"
        >
          {t('invoices.details.receiptPayerRefLabel', locale)}
        </label>
        <input
          id="invoice-receipt-payer-ref"
          data-testid="invoice-receipt-payer-ref"
          name="payerReference"
          type="text"
          autoComplete="off"
          maxLength={128}
          value={payerReference}
          disabled={submitting}
          aria-invalid={error === 'invalid-payer-ref'}
          onChange={(event) => {
            setPayerReference(event.target.value)
            if (error === 'invalid-payer-ref') setError(null)
          }}
          className="mt-1 h-10 w-full rounded-lg border border-gray-300 px-3 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <div>
        <label htmlFor="invoice-receipt-file" className="block text-sm font-medium text-gray-700">
          {t('invoices.details.receiptFileLabel', locale)}
        </label>
        <input
          id="invoice-receipt-file"
          data-testid="invoice-receipt-file"
          name="receiptFile"
          type="file"
          accept={INVOICE_BANK_RECEIPT_FILE_ACCEPT}
          disabled={submitting}
          aria-invalid={error === 'invalid-file'}
          aria-describedby="invoice-receipt-file-hint"
          onChange={(event) => {
            const next = event.target.files?.[0] ?? null
            setFile(next)
            if (error === 'invalid-file' || error === 'upload') setError(null)
          }}
          className="mt-1 block w-full text-sm text-gray-600 file:me-4 file:rounded-lg file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary"
        />
        <p id="invoice-receipt-file-hint" className="mt-2 text-sm text-gray-500">
          {t('invoices.details.receiptFileHint', locale)}
        </p>
      </div>

      <div>
        <label htmlFor="invoice-receipt-note" className="block text-sm font-medium text-gray-700">
          {t('invoices.details.receiptNoteLabel', locale)}
        </label>
        <textarea
          id="invoice-receipt-note"
          data-testid="invoice-receipt-note"
          name="customerNote"
          rows={3}
          maxLength={2000}
          value={customerNote}
          disabled={submitting}
          onChange={(event) => setCustomerNote(event.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <button
        type="submit"
        data-testid="invoice-receipt-submit"
        disabled={submitting}
        className="w-full rounded-lg border border-primary bg-white px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/5 disabled:opacity-60"
      >
        {submitting
          ? t('invoices.details.receiptSubmitting', locale)
          : t('invoices.details.receiptSubmit', locale)}
      </button>
    </form>
  )
}
