import { useState, useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import { t, type Locale } from '@barghsa/i18n'
import { WalletBalanceCard } from '../components/WalletBalanceCard.js'

interface DashboardData {
  wallet: { balance: number; currency: string; lowBalanceWarning: boolean }
  activeOrders: number
  pendingInvoices: number
  openTickets: number
  contracts: { active: number; total: number }
}

function formatRial(amount: number, locale: Locale): string {
  try {
    return new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
      style: 'decimal',
    }).format(amount)
  } catch {
    return amount.toLocaleString()
  }
}

/**
 * Dashboard overview page (T-08.01.01).
 *
 * Shows summary cards for wallet balance, active orders, pending invoices,
 * open tickets, and contract status. Cards are in a responsive grid. Each
 * card is clickable and navigates to the relevant section.
 */
export function DashboardPage({ locale = 'fa' as Locale }) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const isRtl = locale === 'fa'

  useEffect(() => {
    let cancelled = false

    async function fetchDashboard() {
      try {
        const res = await fetch('/api/dashboard', { credentials: 'include' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json: DashboardData = await res.json()
        if (!cancelled) setData(json)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load dashboard')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchDashboard()
    return () => { cancelled = true }
  }, [])

  // Placeholder profile name — in the future read from active profile state
  const profileName = '…'

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 px-4 py-2 bg-primary text-white rounded hover:bg-primary-dark"
        >
          {t('dashboard.overview.moreInfo', locale)}
        </button>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-6">
        {/* Welcome skeleton */}
        <div className="h-8 w-64 bg-gray-200 rounded animate-pulse" />
        {/* Card grid skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-32 bg-gray-200 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  const cards = [
    {
      key: 'orders',
      href: '/electricity',
      label: t('dashboard.overview.activeOrders', locale),
      value: data?.activeOrders != null ? String(data.activeOrders) : '—',
      color: 'border-l-4 border-blue-500',
      actionLabel: t('dashboard.overview.viewOrders', locale),
    },
    {
      key: 'invoices',
      href: '/wallet',
      label: t('dashboard.overview.pendingInvoices', locale),
      value: data?.pendingInvoices != null ? String(data.pendingInvoices) : '—',
      color: data && data.pendingInvoices > 0 ? 'border-l-4 border-red-500' : 'border-l-4 border-gray-400',
      actionLabel: t('dashboard.overview.viewInvoices', locale),
    },
    {
      key: 'tickets',
      href: '/support',
      label: t('dashboard.overview.openTickets', locale),
      value: data?.openTickets != null ? String(data.openTickets) : '—',
      color: data && data.openTickets > 0 ? 'border-l-4 border-amber-500' : 'border-l-4 border-gray-400',
      actionLabel: t('dashboard.overview.viewTickets', locale),
    },
    {
      key: 'contracts',
      href: '/electricity',
      label: t('dashboard.overview.contractStatus', locale),
      value: data
        ? `${data.contracts.active} / ${data.contracts.total}`
        : '—',
      color: 'border-l-4 border-purple-500',
      actionLabel: t('dashboard.overview.viewContracts', locale),
    },
  ]

  const quickActions = [
    { label: t('dashboard.overview.newOrder', locale), href: '/electricity' },
    { label: t('dashboard.overview.topUpWallet', locale), href: '/wallet' },
    { label: t('dashboard.overview.supportTicket', locale), href: '/support' },
  ]

  return (
    <div className="space-y-6" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Welcome message with profile name */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {t('dashboard.overview.welcome', locale).replace('{name}', profileName)}
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {t('dashboard.overview.profileBadge', locale).replace('{name}', profileName)}
          </p>
        </div>
      </div>

      {/* Wallet balance card — dedicated prominent display */}
      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <WalletBalanceCard
              balance={data.wallet.balance}
              currency={data.wallet.currency}
              lowBalanceWarning={data.wallet.lowBalanceWarning}
              pendingInvoices={data.pendingInvoices}
              locale={locale}
            />
          </div>

          {/* Summary cards in responsive grid */}
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
        {cards.map((card) => (
          <Link
            key={card.key}
            to={card.href}
            className={`block bg-white rounded-lg p-5 shadow-sm hover:shadow-md transition-shadow ${card.color}`}
          >
            <p className="text-sm text-gray-500 mb-1">{card.label}</p>
            <p className="text-2xl font-semibold text-gray-900 mb-2">{card.value}</p>
            <span className="text-xs text-primary font-medium">{card.actionLabel} →</span>
          </Link>
        ))}
          </div>
        </div>
      )}

      {/* Quick actions section */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">
          {t('dashboard.overview.quickActions', locale)}
        </h2>
        <div className="flex flex-wrap gap-3">
          {quickActions.map((action) => (
            <Link
              key={action.href}
              to={action.href}
              className="inline-flex items-center px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors"
            >
              {action.label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}