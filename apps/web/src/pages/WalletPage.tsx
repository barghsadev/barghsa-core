import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { t, type Locale } from '@barghsa/i18n'
import { useLocale } from '../hooks/useLocale.js'
import { withCsrf } from '../lib/csrf.js'

interface WalletBalance {
  balance: number
  postedBalance?: number
  reservedBalance?: number
  currency: string
}

type PageError =
  | 'no-profile'
  | 'load'
  | 'invalid-amount'
  | 'limit-exceeded'
  | 'gateway'
  | 'conflict'
  | 'generic'

type ReceiptError =
  | 'invalid-amount'
  | 'invalid-date'
  | 'invalid-payer-ref'
  | 'invalid-file'
  | 'upload'
  | 'conflict'
  | 'generic'

const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024
const IMAGE_MAX_BYTES = 20 * 1024 * 1024

function formatAmount(amount: number, locale: Locale): string {
  try {
    return new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
      style: 'decimal',
    }).format(amount)
  } catch {
    return amount.toLocaleString()
  }
}

function newIdempotencyKey(): string {
  return crypto.randomUUID()
}

function mapSubmitError(status: number, message: string): PageError {
  if (status === 409) return 'conflict'
  if (status === 502 || status === 504) return 'gateway'
  if (status === 400 && /exceeds/i.test(message)) return 'limit-exceeded'
  if (status === 400) return 'invalid-amount'
  return 'generic'
}

function mapReceiptSubmitError(status: number): ReceiptError {
  if (status === 409) return 'conflict'
  if (status === 400) return 'generic'
  return 'generic'
}

/**
 * Map Persian (`۰`–`۹`) and Arabic-Indic (`٠`–`٩`) digits to ASCII, then keep
 * decimal digits only so localized keyboards can enter an IRR amount.
 */
function normalizeIrrAmountDigits(raw: string): string {
  let ascii = ''
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0
    if (code >= 0x06f0 && code <= 0x06f9) {
      ascii += String(code - 0x06f0)
    } else if (code >= 0x0660 && code <= 0x0669) {
      ascii += String(code - 0x0660)
    } else {
      ascii += ch
    }
  }
  return ascii.replace(/[^\d]/g, '')
}

/** Browser redirects must be https destinations without embedded credentials. */
function isSafeGatewayRedirectUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      url.hostname.length > 0
    )
  } catch {
    return false
  }
}

function utcTodayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function receiptCategoryForFile(file: File): 'document' | 'image' | null {
  const name = file.name.toLowerCase()
  const type = file.type.toLowerCase()
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'document'
  if (
    type === 'image/jpeg' ||
    type === 'image/png' ||
    type === 'image/webp' ||
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg') ||
    name.endsWith('.png') ||
    name.endsWith('.webp')
  ) {
    return 'image'
  }
  return null
}

function isAllowedReceiptFile(file: File): boolean {
  const category = receiptCategoryForFile(file)
  if (category === null) return false
  const max = category === 'document' ? DOCUMENT_MAX_BYTES : IMAGE_MAX_BYTES
  return file.size > 0 && file.size <= max
}

async function uploadReceiptAttachment(file: File): Promise<string | null> {
  const category = receiptCategoryForFile(file)
  if (category === null) return null
  const presignRes = await fetch('/api/upload/presigned-url', {
    method: 'POST',
    credentials: 'include',
    headers: withCsrf({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type || (category === 'document' ? 'application/pdf' : 'image/jpeg'),
      fileSize: file.size,
      category,
      metadata: { recordType: 'receipt' },
    }),
  })
  const presign = (await presignRes.json().catch(() => ({}))) as {
    key?: string
    presignedUrl?: string
  }
  if (!presignRes.ok || typeof presign.key !== 'string' || typeof presign.presignedUrl !== 'string') {
    return null
  }

  const putRes = await fetch(presign.presignedUrl, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': file.type || (category === 'document' ? 'application/pdf' : 'image/jpeg'),
    },
  })
  if (!putRes.ok) return null

  const encodedKey = encodeURIComponent(presign.key)
  const verifyRes = await fetch(`/api/upload/${encodedKey}/verify`, {
    method: 'POST',
    credentials: 'include',
    headers: withCsrf({ Accept: 'application/json' }),
  })
  const verify = (await verifyRes.json().catch(() => ({}))) as { status?: string }
  if (!verifyRes.ok || verify.status !== 'confirmed') return null

  const recordRes = await fetch(`/api/upload/${encodedKey}/record`, {
    method: 'POST',
    credentials: 'include',
    headers: withCsrf({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type || undefined,
      fileSize: file.size,
      category,
    }),
  })
  if (!recordRes.ok) return null
  return presign.key
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
export function WalletPage() {
  const locale = useLocale()
  const isRtl = locale === 'fa'

  const [profileId, setProfileId] = useState<string | null>(null)
  const [wallet, setWallet] = useState<WalletBalance | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<PageError | null>(null)
  const [amountInput, setAmountInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey)

  const [receiptAmountInput, setReceiptAmountInput] = useState('')
  const [receiptDate, setReceiptDate] = useState('')
  const [receiptPayerRef, setReceiptPayerRef] = useState('')
  const [receiptNote, setReceiptNote] = useState('')
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [receiptSubmitting, setReceiptSubmitting] = useState(false)
  const [receiptError, setReceiptError] = useState<ReceiptError | null>(null)
  const [receiptSuccess, setReceiptSuccess] = useState(false)
  const [receiptIdempotencyKey, setReceiptIdempotencyKey] = useState(newIdempotencyKey)

  const amountDigits = normalizeIrrAmountDigits(amountInput)
  const amountValue = amountDigits === '' ? null : Number(amountDigits)
  const tomanPreview = useMemo(() => {
    if (amountValue === null || !Number.isSafeInteger(amountValue)) return null
    return Math.round(amountValue / 10)
  }, [amountValue])

  const receiptAmountDigits = normalizeIrrAmountDigits(receiptAmountInput)
  const receiptAmountValue = receiptAmountDigits === '' ? null : Number(receiptAmountDigits)
  const receiptTomanPreview = useMemo(() => {
    if (receiptAmountValue === null || !Number.isSafeInteger(receiptAmountValue)) return null
    return Math.round(receiptAmountValue / 10)
  }, [receiptAmountValue])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const profileRes = await fetch('/api/profiles', { credentials: 'include' })
      if (!profileRes.ok) {
        setError('load')
        return
      }
      const profileData: { activeProfileId: string | null } = await profileRes.json()
      if (!profileData.activeProfileId) {
        setError('no-profile')
        setProfileId(null)
        return
      }
      setProfileId(profileData.activeProfileId)

      const walletRes = await fetch(`/api/wallet/${profileData.activeProfileId}`, {
        credentials: 'include',
      })
      if (!walletRes.ok) {
        setError('load')
        return
      }
      const walletData: WalletBalance = await walletRes.json()
      setWallet(walletData)
    } catch {
      setError('load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profileId || submitting) return

    if (amountValue === null || !Number.isSafeInteger(amountValue) || amountValue <= 0) {
      setError('invalid-amount')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/wallet/${profileId}/top-ups`, {
        method: 'POST',
        credentials: 'include',
        headers: withCsrf({
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        }),
        body: JSON.stringify({ amount: amountValue }),
      })
      const payload = (await res.json().catch(() => ({}))) as {
        redirectUrl?: string
        message?: string
      }
      if (!res.ok || typeof payload.redirectUrl !== 'string' || !payload.redirectUrl) {
        const next = mapSubmitError(res.status, payload.message ?? '')
        if (next === 'limit-exceeded' || next === 'invalid-amount' || next === 'conflict') {
          setIdempotencyKey(newIdempotencyKey())
        }
        setError(next)
        return
      }
      if (!isSafeGatewayRedirectUrl(payload.redirectUrl)) {
        setError('gateway')
        return
      }
      window.location.assign(payload.redirectUrl)
    } catch {
      setError('gateway')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleReceiptSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profileId || receiptSubmitting) return

    if (
      receiptAmountValue === null ||
      !Number.isSafeInteger(receiptAmountValue) ||
      receiptAmountValue <= 0
    ) {
      setReceiptError('invalid-amount')
      setReceiptSuccess(false)
      return
    }
    if (!receiptDate || receiptDate > utcTodayIso()) {
      setReceiptError('invalid-date')
      setReceiptSuccess(false)
      return
    }
    if (receiptPayerRef.trim().length === 0) {
      setReceiptError('invalid-payer-ref')
      setReceiptSuccess(false)
      return
    }
    if (!receiptFile || !isAllowedReceiptFile(receiptFile)) {
      setReceiptError('invalid-file')
      setReceiptSuccess(false)
      return
    }

    setReceiptSubmitting(true)
    setReceiptError(null)
    setReceiptSuccess(false)
    try {
      const attachmentKey = await uploadReceiptAttachment(receiptFile)
      if (!attachmentKey) {
        setReceiptError('upload')
        return
      }

      const res = await fetch(`/api/wallet/${profileId}/bank-receipt-top-ups`, {
        method: 'POST',
        credentials: 'include',
        headers: withCsrf({
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Idempotency-Key': receiptIdempotencyKey,
        }),
        body: JSON.stringify({
          amount: receiptAmountValue,
          paymentDate: receiptDate,
          payerReference: receiptPayerRef.trim(),
          attachmentKey,
          customerNote: receiptNote.trim() === '' ? undefined : receiptNote.trim(),
        }),
      })
      const payload = (await res.json().catch(() => ({}))) as {
        state?: string
        message?: string
      }
      if (!res.ok || payload.state !== 'Pending') {
        const next = mapReceiptSubmitError(res.status)
        if (next === 'conflict') setReceiptIdempotencyKey(newIdempotencyKey())
        setReceiptError(next)
        return
      }

      setReceiptSuccess(true)
      setReceiptIdempotencyKey(newIdempotencyKey())
      setReceiptFile(null)
      const walletRes = await fetch(`/api/wallet/${profileId}`, { credentials: 'include' })
      if (walletRes.ok) {
        setWallet((await walletRes.json()) as WalletBalance)
      }
    } catch {
      setReceiptError('upload')
    } finally {
      setReceiptSubmitting(false)
    }
  }

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
                  : t('wallet.page.loadError', locale)

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
                  : t('wallet.page.receiptGenericError', locale)

  return (
    <div className="mx-auto max-w-lg space-y-6" dir={isRtl ? 'rtl' : 'ltr'} data-testid="wallet-page">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">{t('wallet.page.title', locale)}</h1>
        <p className="mt-2 text-gray-600">{t('wallet.page.subtitle', locale)}</p>
      </header>

      {loading ? (
        <div
          className="h-40 rounded-lg bg-gray-200 animate-pulse"
          aria-hidden="true"
          data-testid="wallet-loading"
        />
      ) : (
        <div className="space-y-6" data-testid="wallet-loaded">
          {wallet && (
            <section className="rounded-lg bg-white p-6 shadow-sm">
              <p className="text-sm text-gray-500">{t('wallet.page.currentBalance', locale)}</p>
              <p className="mt-1 text-3xl font-bold text-gray-900" data-testid="wallet-balance">
                {formatAmount(wallet.balance, locale)}{' '}
                <span className="text-lg font-medium text-gray-500">{wallet.currency}</span>
              </p>
            </section>
          )}

          {errorMessage && (
            <div
              role="alert"
              data-testid="wallet-error"
              className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
            >
              {errorMessage}
            </div>
          )}

          {profileId && (
            <form onSubmit={handleSubmit} className="space-y-4 rounded-lg bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">
                {t('wallet.page.onlineTitle', locale)}
              </h2>
              <div>
                <label htmlFor="top-up-amount" className="block text-sm font-medium text-gray-700">
                  {t('wallet.page.amountLabel', locale)}
                </label>
                <input
                  id="top-up-amount"
                  data-testid="wallet-amount"
                  name="amount"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={amountInput}
                  disabled={submitting}
                  aria-invalid={error === 'invalid-amount' || error === 'limit-exceeded'}
                  aria-describedby="top-up-amount-hint"
                  onChange={(event) => {
                    setAmountInput(normalizeIrrAmountDigits(event.target.value))
                    if (error === 'invalid-amount' || error === 'limit-exceeded') setError(null)
                  }}
                  className="mt-1 h-10 w-full rounded-lg border border-gray-300 px-3 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <p id="top-up-amount-hint" className="mt-2 text-sm text-gray-500">
                  {t('wallet.page.amountHint', locale)}
                </p>
                {tomanPreview !== null && (
                  <p className="mt-1 text-sm text-gray-500" data-testid="wallet-toman">
                    {t('wallet.page.tomanPreview', locale).replace(
                      '{amount}',
                      formatAmount(tomanPreview, locale),
                    )}
                  </p>
                )}
              </div>
              <button
                type="submit"
                data-testid="wallet-submit"
                disabled={submitting}
                className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-60"
              >
                {submitting ? t('wallet.page.submitting', locale) : t('wallet.page.submit', locale)}
              </button>
            </form>
          )}

          {profileId && (
            <form
              onSubmit={handleReceiptSubmit}
              className="space-y-4 rounded-lg bg-white p-6 shadow-sm"
              data-testid="wallet-receipt-form"
            >
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {t('wallet.page.receiptTitle', locale)}
                </h2>
                <p className="mt-1 text-sm text-gray-600">
                  {t('wallet.page.receiptSubtitle', locale)}
                </p>
              </div>

              {receiptSuccess && (
                <div
                  role="status"
                  data-testid="wallet-receipt-success"
                  className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800"
                >
                  {t('wallet.page.receiptSuccess', locale)}
                </div>
              )}

              {receiptErrorMessage && (
                <div
                  role="alert"
                  data-testid="wallet-receipt-error"
                  className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
                >
                  {receiptErrorMessage}
                </div>
              )}

              <div>
                <label
                  htmlFor="receipt-amount"
                  className="block text-sm font-medium text-gray-700"
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
                    setReceiptAmountInput(normalizeIrrAmountDigits(event.target.value))
                    if (receiptError === 'invalid-amount') setReceiptError(null)
                  }}
                  className="mt-1 h-10 w-full rounded-lg border border-gray-300 px-3 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                {receiptTomanPreview !== null && (
                  <p className="mt-1 text-sm text-gray-500" data-testid="wallet-receipt-toman">
                    {t('wallet.page.tomanPreview', locale).replace(
                      '{amount}',
                      formatAmount(receiptTomanPreview, locale),
                    )}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="receipt-date" className="block text-sm font-medium text-gray-700">
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
                    setReceiptDate(event.target.value)
                    if (receiptError === 'invalid-date') setReceiptError(null)
                  }}
                  className="mt-1 h-10 w-full rounded-lg border border-gray-300 px-3 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>

              <div>
                <label
                  htmlFor="receipt-payer-ref"
                  className="block text-sm font-medium text-gray-700"
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
                    setReceiptPayerRef(event.target.value)
                    if (receiptError === 'invalid-payer-ref') setReceiptError(null)
                  }}
                  className="mt-1 h-10 w-full rounded-lg border border-gray-300 px-3 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>

              <div>
                <label htmlFor="receipt-file" className="block text-sm font-medium text-gray-700">
                  {t('wallet.page.receiptFileLabel', locale)}
                </label>
                <input
                  id="receipt-file"
                  data-testid="wallet-receipt-file"
                  name="receiptFile"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                  disabled={receiptSubmitting}
                  aria-invalid={receiptError === 'invalid-file'}
                  aria-describedby="receipt-file-hint"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null
                    setReceiptFile(file)
                    if (receiptError === 'invalid-file' || receiptError === 'upload') {
                      setReceiptError(null)
                    }
                  }}
                  className="mt-1 block w-full text-sm text-gray-600 file:me-4 file:rounded-lg file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary"
                />
                <p id="receipt-file-hint" className="mt-2 text-sm text-gray-500">
                  {t('wallet.page.receiptFileHint', locale)}
                </p>
              </div>

              <div>
                <label htmlFor="receipt-note" className="block text-sm font-medium text-gray-700">
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
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>

              <button
                type="submit"
                data-testid="wallet-receipt-submit"
                disabled={receiptSubmitting}
                className="w-full rounded-lg border border-primary bg-white px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/5 disabled:opacity-60"
              >
                {receiptSubmitting
                  ? t('wallet.page.receiptSubmitting', locale)
                  : t('wallet.page.receiptSubmit', locale)}
              </button>
            </form>
          )}

          {(error === 'load' || error === 'gateway') && (
            <button
              type="button"
              onClick={() => void load()}
              className="text-sm font-medium text-primary hover:underline"
            >
              {t('wallet.page.retry', locale)}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
