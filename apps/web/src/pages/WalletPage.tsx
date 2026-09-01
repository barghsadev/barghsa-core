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

/**
 * Customer wallet top-up page (T-04.2.02.01).
 *
 * Collects a positive IRR amount, starts an online top-up (Pending ledger
 * row + provider session), and redirects the browser to the gateway.
 * The wallet is credited only after the authenticated provider callback.
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

  const amountDigits = amountInput.replace(/[^\d]/g, '')
  const amountValue = amountDigits === '' ? null : Number(amountDigits)
  const tomanPreview = useMemo(() => {
    if (amountValue === null || !Number.isSafeInteger(amountValue)) return null
    return Math.round(amountValue / 10)
  }, [amountValue])

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
      window.location.assign(payload.redirectUrl)
    } catch {
      setError('gateway')
    } finally {
      setSubmitting(false)
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
                    setAmountInput(event.target.value.replace(/[^\d]/g, ''))
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
