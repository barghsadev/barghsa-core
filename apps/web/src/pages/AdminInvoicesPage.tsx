import { useState } from 'react'
import type { FormEvent } from 'react'
import { t } from '@barghsa/i18n'
import type { Locale } from '@barghsa/i18n'
import {
  DUE_AT_OVERRIDE_REASON_MAX_LENGTH,
  parseDueAtOverrideBody,
  type InvoiceDueAtOverrideSnapshot,
} from '@barghsa/shared/finance'
import { useLocale } from '../hooks/useLocale.js'
import { withCsrf } from '../lib/csrf.js'
import {
  datetimeLocalToIso,
  isInvoiceUuid,
  isoToDatetimeLocal,
  lookupMatchesLoadedInvoice,
} from '../lib/due-at-override.js'
import ReminderOffsetTogglePanel from '../components/ReminderOffsetTogglePanel.js'

/**
 * Staff dueAt override page (T-04.1.03.03).
 *
 * Finance staff load an invoice, enter a new due datetime and a required
 * customer-visible reason, and submit. The API stores the reason in
 * invoice metadata and the append-only audit log.
 */

interface InvoiceDueAtDto {
  invoiceId: string
  state: string
  issuedAt: string | null
  payableFrom: string | null
  dueAt: string | null
  canOverride: boolean
  dueAtOverride: InvoiceDueAtOverrideSnapshot | null
  auditId?: string
}

async function parseError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { message?: string; error?: string }
    if (typeof data?.message === 'string' && data.message) return data.message
    if (typeof data?.error === 'string' && data.error) return data.error
  } catch {
    /* fall through */
  }
  return `HTTP ${res.status}`
}

function formatInstant(iso: string | null, locale: Locale): string {
  if (!iso) return t('admin.invoices.none', locale)
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fa-IR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(d)
}

export default function AdminInvoicesPage() {
  const locale = useLocale()
  const [invoiceId, setInvoiceId] = useState('')
  const [invoice, setInvoice] = useState<InvoiceDueAtDto | null>(null)
  const [dueLocal, setDueLocal] = useState('')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clientIssue, setClientIssue] = useState<string | null>(null)

  async function loadInvoice(e?: FormEvent) {
    e?.preventDefault()
    setError(null)
    setSaved(false)
    setClientIssue(null)
    const id = invoiceId.trim()
    if (!isInvoiceUuid(id)) {
      setClientIssue(t('admin.invoices.error.invoiceId', locale))
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/invoices/${id}/due-at`)
      if (!res.ok) throw new Error(await parseError(res))
      const data = (await res.json()) as InvoiceDueAtDto
      setInvoice(data)
      setDueLocal(isoToDatetimeLocal(data.dueAt))
      setReason(data.dueAtOverride?.reason ?? '')
    } catch (err) {
      setInvoice(null)
      setError(err instanceof Error ? err.message : t('admin.invoices.error.load', locale))
    } finally {
      setLoading(false)
    }
  }

  function discardLoadedInvoice() {
    setInvoice(null)
    setDueLocal('')
    setReason('')
    setSaved(false)
    setClientIssue(null)
  }

  function handleInvoiceIdChange(next: string) {
    setInvoiceId(next)
    if (invoice && !lookupMatchesLoadedInvoice(next, invoice.invoiceId)) {
      discardLoadedInvoice()
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaved(false)
    setClientIssue(null)
    setError(null)
    if (!invoice) return
    if (!lookupMatchesLoadedInvoice(invoiceId, invoice.invoiceId)) {
      discardLoadedInvoice()
      return
    }

    const iso = datetimeLocalToIso(dueLocal)
    if (!iso) {
      setClientIssue(t('admin.invoices.error.dueAt', locale))
      return
    }
    const parsed = parseDueAtOverrideBody({ dueAt: iso, reason })
    if (!parsed.ok) {
      setClientIssue(
        parsed.issues.some((i) => i.toLowerCase().includes('reason'))
          ? t('admin.invoices.error.reason', locale)
          : t('admin.invoices.error.dueAt', locale),
      )
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/admin/invoices/${invoice.invoiceId}/due-at`, {
        method: 'POST',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          dueAt: parsed.value.dueAt.toISOString(),
          reason: parsed.value.reason,
        }),
      })
      if (!res.ok) throw new Error(await parseError(res))
      const data = (await res.json()) as InvoiceDueAtDto
      setInvoice(data)
      setDueLocal(isoToDatetimeLocal(data.dueAt))
      setReason(data.dueAtOverride?.reason ?? parsed.value.reason)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.invoices.error.save', locale))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-4xl space-y-8">
      <ReminderOffsetTogglePanel />

      <div className="max-w-xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t('admin.invoices.title', locale)}</h1>
        <p className="text-gray-600 mt-2">{t('admin.invoices.description', locale)}</p>
      </header>

      {error && (
        <div
          className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded"
          role="alert"
        >
          {error}
        </div>
      )}

      <form onSubmit={loadInvoice} className="bg-white rounded-lg border border-gray-200 p-6 space-y-3">
        <div>
          <label htmlFor="invoice-id" className="block text-sm font-medium text-gray-700 mb-1">
            {t('admin.invoices.invoiceId', locale)}
          </label>
          <input
            id="invoice-id"
            name="invoiceId"
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            required
            aria-required="true"
            aria-describedby="invoice-id-hint"
            value={invoiceId}
            onChange={(e) => handleInvoiceIdChange(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 font-mono text-sm"
            dir="ltr"
          />
          <p id="invoice-id-hint" className="text-xs text-gray-500 mt-1">
            {t('admin.invoices.invoiceIdHint', locale)}
          </p>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-900 disabled:opacity-50"
        >
          {loading ? t('admin.invoices.loading', locale) : t('admin.invoices.load', locale)}
        </button>
      </form>

      {invoice && (
        <section
          className="bg-white rounded-lg border border-gray-200 p-6 space-y-4"
          aria-labelledby="override-heading"
        >
          <h2 id="override-heading" className="text-lg font-semibold">
            {t('admin.invoices.title', locale)}
          </h2>

          <dl className="grid grid-cols-1 gap-2 text-sm">
            <div>
              <dt className="text-gray-500">{t('admin.invoices.loadedId', locale)}</dt>
              <dd className="font-mono text-sm" dir="ltr" data-testid="loaded-invoice-id">
                {invoice.invoiceId}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">{t('admin.invoices.state', locale)}</dt>
              <dd className="font-medium">{invoice.state}</dd>
            </div>
            <div>
              <dt className="text-gray-500">{t('admin.invoices.issuedAt', locale)}</dt>
              <dd>{formatInstant(invoice.issuedAt, locale)}</dd>
            </div>
            <div>
              <dt className="text-gray-500">{t('admin.invoices.currentDue', locale)}</dt>
              <dd>{formatInstant(invoice.dueAt, locale)}</dd>
            </div>
          </dl>

          {invoice.dueAtOverride && (
            <p className="text-sm text-gray-600">
              {t('admin.invoices.previousOverride', locale)}: {invoice.dueAtOverride.reason}
            </p>
          )}

          {!invoice.canOverride ? (
            <p className="text-sm text-amber-700" role="status">
              {t('admin.invoices.notOverrideable', locale)}
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div>
                <label htmlFor="due-at" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('admin.invoices.overrideDue', locale)}{' '}
                  <span className="text-red-500" aria-hidden="true">
                    *
                  </span>
                </label>
                <input
                  id="due-at"
                  name="dueAt"
                  type="datetime-local"
                  required
                  aria-required="true"
                  value={dueLocal}
                  onChange={(e) => setDueLocal(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  dir="ltr"
                />
              </div>

              <div>
                <label htmlFor="override-reason" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('admin.invoices.reason', locale)}{' '}
                  <span className="text-red-500" aria-hidden="true">
                    *
                  </span>
                </label>
                <textarea
                  id="override-reason"
                  name="reason"
                  required
                  aria-required="true"
                  aria-describedby="override-reason-hint"
                  maxLength={DUE_AT_OVERRIDE_REASON_MAX_LENGTH}
                  rows={4}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                />
                <p id="override-reason-hint" className="text-xs text-gray-500 mt-1">
                  {t('admin.invoices.reasonHint', locale)}
                </p>
              </div>

              {clientIssue && (
                <p className="text-sm text-red-600" role="alert">
                  {clientIssue}
                </p>
              )}

              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? t('admin.invoices.saving', locale) : t('admin.invoices.submit', locale)}
                </button>
                {saved && (
                  <span className="text-sm text-green-600" role="status">
                    {t('admin.invoices.saved', locale)}
                  </span>
                )}
              </div>
            </form>
          )}
        </section>
      )}

      {clientIssue && !invoice && (
        <p className="text-sm text-red-600" role="alert">
          {clientIssue}
        </p>
      )}
      </div>
    </div>
  )
}
