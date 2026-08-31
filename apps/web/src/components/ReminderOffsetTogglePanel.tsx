import { useState, useEffect, useCallback, useRef } from 'react'
import { t } from '@barghsa/i18n'
import type { Locale } from '@barghsa/i18n'
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

async function parseError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { message?: string; error?: string }
    if (typeof data?.message === 'string' && data.message) return data.message
    if (typeof data?.error === 'string' && data.error) return data.error
  } catch {
    /* fall through */
  }
  return fallback
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
  const [error, setError] = useState<string | null>(null)

  function markPending(key: string, pending: boolean) {
    if (pending) pendingKeysRef.current.add(key)
    else pendingKeysRef.current.delete(key)
    setPendingKeys(new Set(pendingKeysRef.current))
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
    try {
      const res = await fetch('/api/admin/config/invoice-reminder-offsets', {
        method: 'PUT',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ serviceType, offset, enabled }),
      })
      if (!res.ok) {
        throw new Error(await parseError(res, t('admin.invoices.reminders.saveFailed', locale)))
      }
      const data = (await res.json()) as ReminderOffsetToggleDto[]
      const saved = data.find((row) => row.serviceType === serviceType && row.offset === offset)
      setToggles((current) =>
        current
          ? patchCell(current, serviceType, offset, saved?.enabled ?? enabled)
          : current,
      )
    } catch (err) {
      setToggles((current) =>
        current ? patchCell(current, serviceType, offset, previousEnabled) : current,
      )
      setError(err instanceof Error ? err.message : t('admin.invoices.reminders.saveFailed', locale))
    } finally {
      markPending(key, false)
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
    </section>
  )
}
