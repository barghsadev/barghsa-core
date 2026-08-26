import { Link } from '@tanstack/react-router'
import { t, type Locale } from '@barghsa/i18n'
import type { JSX } from 'react'

export interface QuickStatusCardsProps {
  /** Active contracts (confirmed electricity orders). */
  activeContracts: number
  /** Pending orders awaiting processing. */
  pendingOrders: number
  /** Open support tickets. */
  openTickets: number
  /** Unpaid / overdue invoices. */
  unpaidInvoices: number
  /** UI locale. */
  locale?: Locale
}

/** ─── Inline SVG icons ─────────────────────────────────────────────── */

function ContractIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  )
}

function OrderIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3 8 12 12 21 8" />
      <line x1="12" y1="12" x2="12" y2="22" />
      <line x1="8" y1="6" x2="16" y2="10" />
    </svg>
  )
}

function TicketIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
      <path d="M9 9h.01" />
      <path d="M13 9h.01" />
      <path d="M9 13h.01" />
    </svg>
  )
}

function InvoiceIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <path d="M10 9v4" />
      <line x1="7" y1="12" x2="13" y2="12" />
    </svg>
  )
}

/** ─── Per-card colour helpers ────────────────────────────────────────── */

/**
 * Active contracts: any count is a positive signal → green always.
 */
function contractColor(count: number): string {
  if (count === 0) return 'border-l-4 border-gray-400 bg-white'
  return 'border-l-4 border-green-500 bg-green-50'
}

/**
 * Pending orders: 0 = nothing to do (green), 1-2 = attention (yellow), 3+ = action (red).
 */
function orderColor(count: number): string {
  if (count === 0) return 'border-l-4 border-green-500 bg-green-50'
  if (count <= 2) return 'border-l-4 border-yellow-500 bg-yellow-50'
  return 'border-l-4 border-red-500 bg-red-50'
}

/**
 * Open tickets: 0 = good (green), 1-2 = attention (yellow), 3+ = action (red).
 */
function ticketColor(count: number): string {
  if (count === 0) return 'border-l-4 border-green-500 bg-green-50'
  if (count <= 2) return 'border-l-4 border-yellow-500 bg-yellow-50'
  return 'border-l-4 border-red-500 bg-red-50'
}

/**
 * Unpaid invoices: 0 = good (green), 1-2 = attention (yellow), 3+ = action (red).
 */
function invoiceColor(count: number): string {
  if (count === 0) return 'border-l-4 border-green-500 bg-green-50'
  if (count <= 2) return 'border-l-4 border-yellow-500 bg-yellow-50'
  return 'border-l-4 border-red-500 bg-red-50'
}

/** ─── Card definitions ─────────────────────────────────────────────── */

interface CardDef {
  key: string
  icon: (props: { className?: string }) => JSX.Element
  labelKey: string
  href: string
  search?: Record<string, string>
  count: number
  colorFn: (count: number) => string
}

/**
 * Quick status cards (T-08.01.03).
 *
 * Shows four summary cards with icons, per-card colour coding, and links
 * to filtered list pages. Intended for the dashboard overview.
 */
export function QuickStatusCards({
  activeContracts,
  pendingOrders,
  openTickets,
  unpaidInvoices,
  locale = 'fa',
}: QuickStatusCardsProps) {
  const isRtl = locale === 'fa'

  const cards: CardDef[] = [
    {
      key: 'contracts',
      icon: ContractIcon,
      labelKey: 'dashboard.overview.contractStatus',
      href: isRtl ? '/برق' : '/electricity',
      search: { status: 'CONFIRMED' },
      count: activeContracts,
      colorFn: contractColor,
    },
    {
      key: 'orders',
      icon: OrderIcon,
      labelKey: 'dashboard.overview.activeOrders',
      href: isRtl ? '/برق' : '/electricity',
      search: { status: 'PENDING' },
      count: pendingOrders,
      colorFn: orderColor,
    },
    {
      key: 'tickets',
      icon: TicketIcon,
      labelKey: 'dashboard.overview.openTickets',
      href: '/support',
      search: { tab: 'open' },
      count: openTickets,
      colorFn: ticketColor,
    },
    {
      key: 'invoices',
      icon: InvoiceIcon,
      labelKey: 'dashboard.overview.pendingInvoices',
      href: '/wallet',
      search: { state: 'Unpaid,Overdue' },
      count: unpaidInvoices,
      colorFn: invoiceColor,
    },
  ]

  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 gap-4"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {cards.map((card) => {
        const Icon = card.icon
        const colorClass = card.colorFn(card.count)

        return (
          <Link
            key={card.key}
            to={card.href}
            search={card.search}
            className={`block rounded-lg p-5 shadow-sm hover:shadow-md transition-shadow ${colorClass}`}
          >
            <div className={`flex items-start gap-3 ${isRtl ? 'flex-row-reverse' : ''}`}>
              <Icon className="w-8 h-8 text-gray-600 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-500 mb-1">
                  {t(card.labelKey as keyof typeof t, locale)}
                </p>
                <p className="text-2xl font-semibold text-gray-900">
                  {card.count}
                </p>
              </div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}