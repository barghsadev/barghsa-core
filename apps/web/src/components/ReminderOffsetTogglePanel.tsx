import { useState, useEffect, useCallback, useRef, type FormEvent } from 'react'
import { t } from '@barghsa/i18n'
import type { Locale } from '@barghsa/i18n'
import { ErrorCodes } from '@barghsa/shared/errors'
import {
  INVOICE_REMINDER_OFFSETS,
  SERVICE_DUE_PERIOD_TYPES,
  type InvoiceReminderOffset,
  type ReminderOffsetToggleDto,
  type ServiceDuePeriodType,
} from '@barghsa/shared/finance'
import { useLocale } from '../hooks/useLocale.js'
import { withCsrf } from '../lib/csrf.js'

/**
 * Admin reminder-offset toggle panel (T-04.1.04.05).
 *
 * Matrix of service types × canonical offsets. Each cell is a switch
 * that PUTs immediately. Missing pairs default to enabled on the API.
 */

const OFFSET_KEY: Record<InvoiceReminderOffset, string> = {
  [-7]: 'admin.invoices.reminders.offset.m7',
  [-3]: 'admin.invoices.reminders.offset.m3',
  [-1]: 'admin.invoices.reminders.offset.m1',
  [0]: 'admin.invoices.reminders.offset.0',
  [1]: 'admin.invoices.reminders.offset.p1',
  [7]: 'admin.invoices.reminders.offset.p7',
}

function serviceKey(serviceType: ServiceDuePeriodType): string {
  return `admin.invoices.reminders.service.${serviceType}`
}

function toggleKey(serviceType: ServiceDuePeriodType, offset: InvoiceReminderOffset): string {
  return `${serviceType}:${offset}`
}

function isEnabled(
  toggles: ReminderOffsetToggleDto[],
  serviceType: ServiceDuePeriodType,
  offset: InvoiceReminderOffset,
): boolean {
  return toggles.find((row) => row.serviceType === serviceType && row.offset === offset)?.enabled ?? true
}

/** Patch a single cell. Never replace the rest of the matrix from a request snapshot. */
function patchCell(
  current: ReminderOffsetToggleDto[],
  serviceType: ServiceDuePeriodType,
  offset: InvoiceReminderOffset,
  enabled: boolean,
): ReminderOffsetToggleDto[] {
  let found = false
  const next = current.map((row) => {
    if (row.serviceType === serviceType && row.offset === offset) {
      found = true
      return { ...row, enabled }
    }
    return row
  })
  return found ? next : [...next, { serviceType, offset, enabled }]
}

type PendingToggle = {
  serviceType: ServiceDuePeriodType
  offset: InvoiceReminderOffset
  enabled: boolean
  previousEnabled: boolean
}

type SaveResult =
  | { kind: 'ok'; enabled: boolean }
  | { kind: 'step_up' }
  | { kind: 'error'; message: string }

function readErrorCode(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const rec = data as { error?: unknown; requiresStepUp?: unknown }
  if (typeof rec.error === 'string') return rec.error
  if (rec.error && typeof rec.error === 'object') {
    const nested = rec.error as { code?: unknown }
    if (typeof nested.code === 'string') return nested.code
  }
  if (rec.requiresStepUp === true) return ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code
  return null
}

function errorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object') return fallback
  const rec = data as { message?: unknown; error?: unknown }
  if (typeof rec.message === 'string' && rec.message) return rec.message
  if (rec.error && typeof rec.error === 'object') {
    const nested = rec.error as { message?: unknown }
    if (typeof nested.message === 'string' && nested.message) return nested.message
  }
  if (typeof rec.error === 'string' && rec.error) return rec.error
  return fallback
}

function isStepUpRequired(res: Response, data: unknown): boolean {
  return res.status === 403 && readErrorCode(data) === ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code
}

async function parseError(res: Response, fallback: string): Promise<string> {
  try {
    return errorMessage(await res.json(), fallback)
  } catch {
    return fallback
  }
}

async function saveToggle(
  serviceType: ServiceDuePeriodType,
  offset: InvoiceReminderOffset,
  enabled: boolean,
  fallback: string,
): Promise<SaveResult> {
  try {
    const res = await fetch('/api/admin/config/invoice-reminder-offsets', {
      method: 'PUT',
      headers: withCsrf({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ serviceType, offset, enabled }),
    })
    const data: unknown = await res.json().catch(() => null)
    if (isStepUpRequired(res, data)) return { kind: 'step_up' }
    if (!res.ok) return { kind: 'error', message: errorMessage(data, fallback) }
    const matrix = Array.isArray(data) ? (data as ReminderOffsetToggleDto[]) : []
    const saved = matrix.find((row) => row.serviceType === serviceType && row.offset === offset)
    return { kind: 'ok', enabled: saved?.enabled ?? enabled }
  } catch {
    return { kind: 'error', message: fallback }
  }
}

async function verifyStepUp(password: string): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/step-up', {
      method: 'POST',
      headers: withCsrf({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ password }),
    })
    return res.ok
  } catch {
    return false
  }
}

function ariaLabel(
  locale: Locale,
  serviceType: ServiceDuePeriodType,
  offset: InvoiceReminderOffset,
): string {
  return t('admin.invoices.reminders.toggleAria', locale)
    .replace('{offset}', t(OFFSET_KEY[offset], locale))
    .replace('{service}', t(serviceKey(serviceType), locale))
}

export default function ReminderOffsetTogglePanel() {
  const locale = useLocale()
  const isRtl = locale === 'fa'
  const [toggles, setToggles] = useState<ReminderOffsetToggleDto[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(() => new Set())
  const pendingKeysRef = useRef(new Set<string>())
  const awaitingStepUpRef = useRef<PendingToggle[]>([])
  const [error, setError] = useState<string | null>(null)
  const [stepUpOpen, setStepUpOpen] = useState(false)
  const [stepUpPassword, setStepUpPassword] = useState('')
  const [stepUpError, setStepUpError] = useState<string | null>(null)
  const [stepUpSubmitting, setStepUpSubmitting] = useState(false)

  function markPending(key: string, pending: boolean) {
    if (pending) pendingKeysRef.current.add(key)
    else pendingKeysRef.current.delete(key)
    setPendingKeys(new Set(pendingKeysRef.current))
  }

  function revertToggle(item: PendingToggle) {
    setToggles((current) =>
      current ? patchCell(current, item.serviceType, item.offset, item.previousEnabled) : current,
    )
    markPending(toggleKey(item.serviceType, item.offset), false)
  }

  async function persistToggle(item: PendingToggle): Promise<'step_up' | 'done'> {
    const fallback = t('admin.invoices.reminders.saveFailed', locale)
    try {
      const result = await saveToggle(item.serviceType, item.offset, item.enabled, fallback)
      if (result.kind === 'step_up') return 'step_up'
      if (result.kind === 'error') {
        revertToggle(item)
        setError(result.message)
        return 'done'
      }
      setToggles((current) =>
        current ? patchCell(current, item.serviceType, item.offset, result.enabled) : current,
      )
      markPending(toggleKey(item.serviceType, item.offset), false)
      return 'done'
    } catch {
      revertToggle(item)
      setError(fallback)
      return 'done'
    }
  }

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/admin/config/invoice-reminder-offsets')
      if (!res.ok) {
        throw new Error(await parseError(res, t('admin.invoices.reminders.loadFailed', locale)))
      }
      const data = (await res.json()) as ReminderOffsetToggleDto[]
      setToggles(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.invoices.reminders.loadFailed', locale))
    } finally {
      setLoading(false)
    }
  }, [locale])

  useEffect(() => {
    load()
  }, [load])

  async function handleToggle(
    serviceType: ServiceDuePeriodType,
    offset: InvoiceReminderOffset,
    enabled: boolean,
  ) {
    if (!toggles) return
    const key = toggleKey(serviceType, offset)
    if (pendingKeysRef.current.has(key)) return
    const previousEnabled = isEnabled(toggles, serviceType, offset)
    markPending(key, true)
    setToggles((current) =>
      current ? patchCell(current, serviceType, offset, enabled) : current,
    )
    setError(null)
    const item: PendingToggle = { serviceType, offset, enabled, previousEnabled }
    const outcome = await persistToggle(item)
    if (outcome === 'step_up') {
      awaitingStepUpRef.current.push(item)
      setStepUpOpen(true)
    }
  }

  function cancelStepUp() {
    const pending = awaitingStepUpRef.current
    awaitingStepUpRef.current = []
    for (const item of pending) revertToggle(item)
    setStepUpOpen(false)
    setStepUpPassword('')
    setStepUpError(null)
    setStepUpSubmitting(false)
  }

  async function submitStepUp(event: FormEvent) {
    event.preventDefault()
    if (!stepUpPassword.trim() || stepUpSubmitting) return
    setStepUpSubmitting(true)
    setStepUpError(null)
    try {
      let verified = false
      try {
        verified = await verifyStepUp(stepUpPassword)
      } catch {
        setStepUpError(t('admin.invoices.reminders.stepUp.failed', locale))
        return
      }
      if (!verified) {
        setStepUpError(t('admin.invoices.reminders.stepUp.failed', locale))
        return
      }
      const pending = awaitingStepUpRef.current
      awaitingStepUpRef.current = []
      setStepUpOpen(false)
      setStepUpPassword('')
      for (const item of pending) {
        const outcome = await persistToggle(item)
        if (outcome === 'step_up') {
          revertToggle(item)
          setError(t('admin.invoices.reminders.saveFailed', locale))
        }
      }
    } finally {
      setStepUpSubmitting(false)
    }
  }

  if (loading && !toggles) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6 text-gray-500" dir={isRtl ? 'rtl' : 'ltr'}>
        {t('admin.invoices.reminders.loading', locale)}
      </div>
    )
  }

  return (
    <section
      className="bg-white rounded-lg border border-gray-200 p-6 space-y-4"
      dir={isRtl ? 'rtl' : 'ltr'}
      aria-labelledby="reminder-offset-heading"
    >
      <div>
        <h2 id="reminder-offset-heading" className="text-lg font-semibold">
          {t('admin.invoices.reminders.title', locale)}
        </h2>
        <p className="text-sm text-gray-500 mt-1">{t('admin.invoices.reminders.description', locale)}</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded" role="alert">
          {error}
        </div>
      )}

      {toggles && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border-collapse">
            <caption className="sr-only">{t('admin.invoices.reminders.title', locale)}</caption>
            <thead>
              <tr>
                <th scope="col" className="text-start font-medium text-gray-600 py-2 pe-4">
                  {t('admin.invoices.reminders.serviceCol', locale)}
                </th>
                {INVOICE_REMINDER_OFFSETS.map((offset) => (
                  <th
                    key={offset}
                    scope="col"
                    className="text-center font-medium text-gray-600 py-2 px-2 whitespace-nowrap"
                  >
                    {t(OFFSET_KEY[offset], locale)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SERVICE_DUE_PERIOD_TYPES.map((serviceType) => (
                <tr key={serviceType} className="border-t border-gray-100">
                  <th scope="row" className="text-start font-medium py-3 pe-4 whitespace-nowrap">
                    {t(serviceKey(serviceType), locale)}
                  </th>
                  {INVOICE_REMINDER_OFFSETS.map((offset) => {
                    const enabled = isEnabled(toggles, serviceType, offset)
                    const key = toggleKey(serviceType, offset)
                    const busy = pendingKeys.has(key)
                    return (
                      <td key={offset} className="text-center py-3 px-2">
                        <label className="inline-flex items-center justify-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            role="switch"
                            data-testid={`reminder-toggle-${serviceType}-${offset}`}
                            aria-label={ariaLabel(locale, serviceType, offset)}
                            aria-checked={enabled}
                            aria-busy={busy}
                            checked={enabled}
                            disabled={busy}
                            onChange={(e) => handleToggle(serviceType, offset, e.target.checked)}
                            className="h-4 w-4 rounded border-gray-300"
                          />
                          <span className="sr-only">
                            {enabled
                              ? t('admin.invoices.reminders.enabled', locale)
                              : t('admin.invoices.reminders.disabled', locale)}
                          </span>
                        </label>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {stepUpOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reminder-step-up-title"
          data-testid="reminder-step-up-dialog"
          onClick={(event) => {
            if (event.target === event.currentTarget && !stepUpSubmitting) cancelStepUp()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !stepUpSubmitting) cancelStepUp()
          }}
        >
          <form
            className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full space-y-4"
            onClick={(event) => event.stopPropagation()}
            onSubmit={submitStepUp}
          >
            <div>
              <h3 id="reminder-step-up-title" className="text-lg font-semibold text-gray-900">
                {t('admin.invoices.reminders.stepUp.title', locale)}
              </h3>
              <p className="text-sm text-gray-600 mt-1">
                {t('admin.invoices.reminders.stepUp.description', locale)}
              </p>
            </div>
            <div className="space-y-2">
              <label htmlFor="reminder-step-up-password" className="block text-sm font-medium text-gray-700">
                {t('admin.invoices.reminders.stepUp.passwordLabel', locale)}
              </label>
              <input
                id="reminder-step-up-password"
                data-testid="reminder-step-up-password"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={stepUpPassword}
                disabled={stepUpSubmitting}
                placeholder={t('admin.invoices.reminders.stepUp.passwordPlaceholder', locale)}
                onChange={(event) => {
                  setStepUpPassword(event.target.value)
                  setStepUpError(null)
                }}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
              {stepUpError && (
                <p className="text-sm text-red-700" role="alert">
                  {stepUpError}
                </p>
              )}
            </div>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                data-testid="reminder-step-up-cancel"
                disabled={stepUpSubmitting}
                onClick={cancelStepUp}
                className="px-4 py-2 text-sm rounded bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors disabled:opacity-50"
              >
                {t('admin.invoices.reminders.stepUp.cancel', locale)}
              </button>
              <button
                type="submit"
                data-testid="reminder-step-up-submit"
                disabled={stepUpSubmitting || !stepUpPassword.trim()}
                className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {stepUpSubmitting
                  ? t('admin.invoices.reminders.stepUp.verifying', locale)
                  : t('admin.invoices.reminders.stepUp.submit', locale)}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  )
}
