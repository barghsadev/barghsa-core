import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { t, type Locale } from '@barghsa/i18n'
import { validateWalletTopUpLimitConfig } from '@barghsa/shared/finance'
import { useLocale } from '../hooks/useLocale.js'
import { withCsrf } from '../lib/csrf.js'

/**
 * Admin panel for the versioned `onlineTopUpLimit` (T-04.2.02.06).
 *
 * Number input with grouped IRR formatting and a Toman preview. The
 * warning matches T-09.10.01: changing the limit affects future online
 * top-ups only. Server validation remains authoritative.
 */

interface WalletTopUpLimitDto {
  limitIrR: number
  version?: number
}

function normalizeIrrDigits(raw: string): string {
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

function formatGroupedIrr(digits: string, locale: Locale): string {
  if (digits === '') return ''
  try {
    return new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US').format(BigInt(digits))
  } catch {
    return digits
  }
}

export default function WalletTopUpLimitConfigPanel() {
  const locale = useLocale()
  const [config, setConfig] = useState<WalletTopUpLimitDto | null>(null)
  const [limitDigits, setLimitDigits] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [clientIssue, setClientIssue] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setForbidden(false)
      const res = await fetch('/api/admin/config/wallet-top-up-limit', {
        credentials: 'include',
      })
      if (res.status === 403) {
        setForbidden(true)
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as WalletTopUpLimitDto
      setConfig(data)
      setLimitDigits(String(data.limitIrR))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.walletLimit.loadFailed', locale))
    } finally {
      setLoading(false)
    }
  }, [locale])

  useEffect(() => {
    void load()
  }, [load])

  const tomanPreview = useMemo(() => {
    if (limitDigits === '') return null
    try {
      return BigInt(limitDigits) / 10n
    } catch {
      return null
    }
  }, [limitDigits])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const raw = limitDigits === '' ? undefined : Number(limitDigits)
    const validation = validateWalletTopUpLimitConfig({ limit_irr: raw })
    if (!validation.ok) {
      setClientIssue(
        t('admin.walletLimit.invalid', locale).replace('{max}', String(Number.MAX_SAFE_INTEGER)),
      )
      return
    }
    setClientIssue(null)
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const res = await fetch('/api/admin/config/wallet-top-up-limit', {
        method: 'PUT',
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ limit_irr: raw }),
      })
      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { message?: string }
        throw new Error(errData.message ?? `HTTP ${res.status}`)
      }
      const data = (await res.json()) as WalletTopUpLimitDto
      setConfig(data)
      setLimitDigits(String(data.limitIrR))
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.walletLimit.saveFailed', locale))
    } finally {
      setSaving(false)
    }
  }

  if (forbidden) {
    return null
  }

  if (loading && !config) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6 text-gray-500" role="status">
        {t('admin.walletLimit.loading', locale)}
      </div>
    )
  }

  return (
    <section
      className="bg-white rounded-lg border border-gray-200 p-6 space-y-4"
      data-testid="wallet-top-up-limit-panel"
      aria-labelledby="wallet-top-up-limit-heading"
    >
      <div>
        <h2 id="wallet-top-up-limit-heading" className="text-lg font-semibold">
          {t('admin.walletLimit.title', locale)}
        </h2>
        <p className="text-sm text-gray-500 mt-1">{t('admin.walletLimit.description', locale)}</p>
      </div>

      <p
        className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2"
        role="note"
        id="online-top-up-limit-warning"
        data-testid="wallet-top-up-limit-warning"
      >
        {t('admin.walletLimit.warning', locale)}
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded" role="alert">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="online-top-up-limit" className="block text-sm font-medium text-gray-700 mb-1">
            {t('admin.walletLimit.label', locale)} <span className="text-red-500">*</span>
          </label>
          <input
            id="online-top-up-limit"
            data-testid="wallet-top-up-limit-input"
            name="limit_irr"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            dir="ltr"
            value={formatGroupedIrr(limitDigits, locale)}
            onChange={(event) => {
              setLimitDigits(normalizeIrrDigits(event.target.value))
              setSaved(false)
              setClientIssue(null)
            }}
            className="w-full border border-gray-300 rounded px-3 py-2"
            aria-describedby="online-top-up-limit-toman online-top-up-limit-warning"
          />
          {tomanPreview !== null && (
            <p id="online-top-up-limit-toman" className="mt-1 text-sm text-gray-500" data-testid="wallet-top-up-limit-toman">
              {t('admin.walletLimit.toman', locale).replace(
                '{amount}',
                formatGroupedIrr(tomanPreview.toString(), locale),
              )}
            </p>
          )}
        </div>

        {clientIssue && (
          <p className="text-sm text-red-600" role="alert">
            {clientIssue}
          </p>
        )}

        {config && (
          <p className="text-xs text-gray-400" data-testid="wallet-top-up-limit-current">
            {t('admin.walletLimit.current', locale)}:{' '}
            <span className="font-mono">{formatGroupedIrr(String(config.limitIrR), locale)}</span>
            {typeof config.version === 'number' && (
              <>
                {' · '}
                {t('admin.walletLimit.version', locale).replace('{version}', String(config.version))}
              </>
            )}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            data-testid="wallet-top-up-limit-save"
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? t('admin.walletLimit.saving', locale) : t('admin.walletLimit.save', locale)}
          </button>
          {saved && (
            <span className="text-sm text-green-600" role="status">
              {t('admin.walletLimit.saved', locale)}
            </span>
          )}
        </div>
      </form>
    </section>
  )
}
