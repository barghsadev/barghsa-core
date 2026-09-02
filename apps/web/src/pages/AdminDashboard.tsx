/**
 * Admin dashboard page — heavy module, lazy-loaded.
 */
import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { t } from '@barghsa/i18n'
import { useLocale } from '../hooks/useLocale.js'

interface PendingVerificationProfile {
  id: string
  profileType: 'INDIVIDUAL' | 'LEGAL'
  firstName: string | null
  lastName: string | null
  legalName: string | null
  createdAt: string
}

interface PendingVerificationData {
  count: number
  profiles: PendingVerificationProfile[]
}

interface UnresolvedChargebackItem {
  eventId: string
  status: 'unmatched' | 'unresolved'
  amountIrR: string | null
  walletId: string | null
  originalTransactionId: string | null
  reason: string | null
  createdAt: string
}

interface UnresolvedChargebackWarning {
  count: number
  unmatchedCount: number
  reversalFailedCount: number
  items: UnresolvedChargebackItem[]
}

export default function AdminDashboard() {
  const [data, setData] = useState<PendingVerificationData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isError, setIsError] = useState(false)
  const [chargebacks, setChargebacks] = useState<UnresolvedChargebackWarning | null>(null)
  const [chargebacksLoading, setChargebacksLoading] = useState(true)
  const [chargebacksError, setChargebacksError] = useState(false)
  const locale = useLocale()

  useEffect(() => {
    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null

    const fetchData = async () => {
      try {
        const res = await fetch('/api/crm/dashboard/pending-verification')
        if (!res.ok) throw new Error('Failed to fetch')
        const json = await res.json() as PendingVerificationData
        if (!cancelled) {
          setData(json)
          setIsLoading(false)
          setIsError(false)
        }
      } catch {
        if (!cancelled) {
          setIsLoading(false)
          setIsError(true)
        }
      }
    }

    const fetchChargebacks = async () => {
      try {
        const res = await fetch('/api/admin/wallet/chargebacks/unresolved-warning')
        if (!res.ok) throw new Error('Failed to fetch')
        const json = await res.json() as UnresolvedChargebackWarning
        if (!cancelled) {
          setChargebacks(json)
          setChargebacksLoading(false)
          setChargebacksError(false)
        }
      } catch {
        if (!cancelled) {
          setChargebacksLoading(false)
          setChargebacksError(true)
        }
      }
    }

    fetchData()
    fetchChargebacks()
    intervalId = setInterval(() => {
      fetchData()
      fetchChargebacks()
    }, 30_000)

    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
    }
  }, [])

  const showChargebackWarning = !chargebacksLoading && !chargebacksError && (chargebacks?.count ?? 0) > 0

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">{t('dashboard.admin.title', locale)}</h1>
      <p className="text-gray-600 mb-6">{t('dashboard.admin.description', locale)}</p>

      {chargebacksError ? (
        <p className="mb-6 text-sm text-red-600" role="status">
          {t('dashboard.admin.chargebackWarning.error', locale)}
        </p>
      ) : null}

      {showChargebackWarning && chargebacks ? (
        <section
          className="mb-6 max-w-2xl rounded-lg border border-red-300 bg-red-50 p-5"
          role="alert"
          aria-live="assertive"
          aria-label={t('dashboard.admin.chargebackWarning.aria.banner', locale)}
        >
          <div className="mb-3 flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle className="h-5 w-5 text-red-700" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-red-900">
                {t('dashboard.admin.chargebackWarning.title', locale)}
              </h2>
              <p className="text-sm text-red-800">
                {t('dashboard.admin.chargebackWarning.summary', locale)
                  .replace('{count}', String(chargebacks.count))
                  .replace('{unmatched}', String(chargebacks.unmatchedCount))
                  .replace('{failed}', String(chargebacks.reversalFailedCount))}
              </p>
            </div>
          </div>
          <ul className="space-y-2">
            {chargebacks.items.map((item) => (
              <li
                key={item.eventId}
                className="rounded-md border border-red-200 bg-white px-3 py-2 text-sm text-gray-800"
              >
                <p className="font-medium">
                  {t(`dashboard.admin.chargebackWarning.status.${item.status}`, locale)}
                  {item.amountIrR
                    ? ` · ${t('dashboard.admin.chargebackWarning.amount', locale).replace('{amount}', item.amountIrR)}`
                    : ''}
                </p>
                <p className="text-xs text-gray-600">
                  {t('dashboard.admin.chargebackWarning.eventId', locale).replace(
                    '{id}',
                    item.eventId,
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Pending verification widget */}
      <div
        className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 max-w-sm"
        role="region"
        aria-label={t('dashboard.admin.pendingVerification.aria.widget', locale)}
      >
        <div className="flex items-center gap-3 mb-3">
          {/* Icon */}
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-amber-600" aria-hidden="true" />
          </div>
          <div role="status" aria-live="polite" aria-busy={isLoading}>
            {isLoading ? (
              <div className="h-6 w-12 bg-gray-200 animate-pulse rounded" aria-label={t('dashboard.admin.pendingVerification.loading', locale)} />
            ) : isError ? (
              <p className="text-sm text-red-500">{t('dashboard.admin.pendingVerification.error', locale)}</p>
            ) : (
              <>
                <p
                  className="text-2xl font-bold text-gray-900"
                  aria-label={t('dashboard.admin.pendingVerification.aria.count', locale)}
                >
                  {data?.count ?? 0}
                </p>
                <p className="text-sm text-gray-500">{t('dashboard.admin.pendingVerification.label', locale)}</p>
              </>
            )}
          </div>
        </div>
        <Link
          to="/admin/crm"
          search={{ verification: 'PENDING' }}
          className="text-sm text-blue-600 hover:text-blue-800 hover:underline font-medium"
          aria-label={t('dashboard.admin.pendingVerification.aria.showAll', locale)}
        >
          {t('dashboard.admin.pendingVerification.showAll', locale)}
        </Link>
      </div>
    </div>
  )
}
