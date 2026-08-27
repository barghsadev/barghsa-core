import { useState, useEffect, useCallback } from 'react'
import type { FormEvent } from 'react'
import { t } from '@barghsa/i18n'
import type { Locale } from '@barghsa/i18n'

/**
 * Delivery-window configuration panel (E-05, T-05.03.03).
 *
 * Admin section under Notifications settings that lets an admin configure the
 * daily daytime delivery window: a start-hour selector, an end-hour selector,
 * and a timezone selector. Rules enforced both client-side and server-side:
 *  - start < end
 *  - window length >= 4 hours
 *  - a valid IANA timezone
 *
 * The worker (T-05.03.02) reads this from `app_config` via
 * `loadDeliveryWindowConfig`, gating external-channel daytime messages outside
 * the window. Changes take effect for newly-scheduled messages; already
 * scheduled messages keep their original timing (per story T-05.03.03).
 */

interface DeliveryWindowConfig {
  timezone: string
  startHour: number
  endHour: number
}

interface DeliveryWindowConfigPanelProps {
  uiLocale: Locale
}

const DEFAULT_WINDOW: DeliveryWindowConfig = { timezone: 'Asia/Tehran', startHour: 9, endHour: 21 }

/** Common IANA timezones relevant to the platform's Iranian user base. */
const TIMEZONE_OPTIONS = ['Asia/Tehran', 'UTC', 'Asia/Dubai', 'Europe/Berlin', 'Europe/London', 'America/New_York']

/** Generate 0–23 hour options (as integers, formatters render as HH:00). */
function hourOptions(): number[] {
  const out: number[] = []
  for (let h = 0; h < 24; h++) out.push(h)
  return out
}

/** Render an hour-of-day as an HH:00 clock string (24h). */
function formatHour(hour: number): string {
  const hh = String(hour).padStart(2, '0')
  return `${hh}:00`
}

export default function DeliveryWindowConfigPanel({ uiLocale }: DeliveryWindowConfigPanelProps) {
  const [config, setConfig] = useState<DeliveryWindowConfig | null>(null)
  const [timezone, setTimezone] = useState(DEFAULT_WINDOW.timezone)
  const [startHour, setStartHour] = useState(DEFAULT_WINDOW.startHour)
  const [endHour, setEndHour] = useState(DEFAULT_WINDOW.endHour)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clientIssue, setClientIssue] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/admin/config/delivery-window')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as DeliveryWindowConfig
      setConfig(data)
      setTimezone(data.timezone)
      setStartHour(data.startHour)
      setEndHour(data.endHour)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.notifications.window.loadFailed', uiLocale))
    } finally {
      setLoading(false)
    }
  }, [uiLocale])

  useEffect(() => {
    load()
  }, [load])

  /** Client-side validation mirroring the shared rules (T-05.03.03). */
  function validate(start: number, end: number): string | null {
    if (start >= end) return t('admin.notifications.window.errBeforeEnd', uiLocale)
    if (end - start < 4) return t('admin.notifications.window.errTooShort', uiLocale)
    return null
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const issue = validate(startHour, endHour)
    if (issue) {
      setClientIssue(issue)
      return
    }
    setClientIssue(null)
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const res = await fetch('/api/admin/config/delivery-window', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timezone,
          start_hour: startHour,
          end_hour: endHour,
        }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error((errData as { message?: string }).message ?? `HTTP ${res.status}`)
      }
      const data = (await res.json()) as DeliveryWindowConfig
      setConfig(data)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.notifications.window.saveFailed', uiLocale))
    } finally {
      setSaving(false)
    }
  }

  if (loading && !config) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6 text-gray-500">
        {t('admin.notifications.window.loading', uiLocale)}
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('admin.notifications.window.title', uiLocale)}</h2>
        <p className="text-sm text-gray-500 mt-1">{t('admin.notifications.window.description', uiLocale)}</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded relative">
          {error}
          <button
            onClick={() => setError(null)}
            className="absolute top-2 right-2 text-red-500 hover:text-red-700"
          >
            ✕
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {/* Timezone */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('admin.notifications.window.timezone', uiLocale)} <span className="text-red-500">*</span>
          </label>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2"
          >
            {TIMEZONE_OPTIONS.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>

        {/* Start / End hour */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('admin.notifications.window.start', uiLocale)} <span className="text-red-500">*</span>
            </label>
            <select
              value={startHour}
              onChange={(e) => setStartHour(Number(e.target.value))}
              className="w-full border border-gray-300 rounded px-3 py-2"
            >
              {hourOptions().map((h) => (
                <option key={h} value={h}>
                  {formatHour(h)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('admin.notifications.window.end', uiLocale)} <span className="text-red-500">*</span>
            </label>
            <select
              value={endHour}
              onChange={(e) => setEndHour(Number(e.target.value))}
              className="w-full border border-gray-300 rounded px-3 py-2"
            >
              {hourOptions().map((h) => (
                <option key={h} value={h}>
                  {formatHour(h)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {clientIssue && (
          <p className="text-sm text-red-600">{clientIssue}</p>
        )}

        {config && (
          <p className="text-xs text-gray-400">
            {t('admin.notifications.window.current', uiLocale)}:{' '}
            <span className="font-mono">
              {config.timezone} {formatHour(config.startHour)}–{formatHour(config.endHour)}
            </span>
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? t('admin.notifications.window.saving', uiLocale) : t('admin.notifications.window.save', uiLocale)}
          </button>
          {saved && <span className="text-sm text-green-600">{t('admin.notifications.window.saved', uiLocale)}</span>}
        </div>
      </form>
    </div>
  )
}
