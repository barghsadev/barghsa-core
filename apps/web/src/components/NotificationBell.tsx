import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, type NavigateOptions } from '@tanstack/react-router'
import { t } from '@barghsa/i18n'
import { BellIcon, CheckCheckIcon } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSeparator,
} from '@barghsa/ui'
import { useLocale } from '../hooks/useLocale.js'
import {
  fetchNotifications,
  markOneRead,
  markAllRead,
  toNavigationTarget,
  type NotificationItem,
} from '../lib/notifications.js'
import { NotificationRow } from './NotificationRow.js'

const DROPDOWN_SIZE = 10

/**
 * Header notification bell (E-05, T-05.02.03).
 *
 * A bell icon with an unread-count badge that opens a dropdown showing the
 * latest notifications plus quick actions ("mark all read", "view all"). Each
 * item is marked read on click and navigates to its linked record when one is
 * set. Supports RTL and shows a loading skeleton and empty state.
 */
export function NotificationBell() {
  const locale = useLocale()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const page = await fetchNotifications(undefined, 'all', DROPDOWN_SIZE)
      setItems(page.data)
      setUnreadCount(page.unread_count)
      setError(null)
    } catch {
      setError(t('notifications.error.load', locale))
    } finally {
      setLoading(false)
    }
  }, [locale])

  // Load once on mount so the badge is accurate before the dropdown is opened.
  useEffect(() => {
    void load()
  }, [load])

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) void load()
  }

  const handleItemClick = async (item: NotificationItem) => {
    const target = toNavigationTarget(item)
    if (!item.isRead) {
      try {
        const count = await markOneRead(item.id)
        setUnreadCount(count)
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, isRead: true } : i)),
        )
      } catch {
        // Non-blocking: navigation still proceeds if a route exists.
      }
    }
    if (target) {
      navigate({
        to: target.to,
        search: target.search as NavigateOptions['search'],
      } as NavigateOptions)
    }
    setOpen(false)
  }

  const handleMarkAll = async () => {
    try {
      const count = await markAllRead()
      setUnreadCount(count)
      setItems((prev) => prev.map((i) => ({ ...i, isRead: true })))
    } catch {
      // Non-blocking
    }
  }

  const badgeLabel = unreadCount > 99 ? '99+' : String(unreadCount)
  const bellAria = t('notifications.bellAria', locale).replace(
    '{count}',
    String(unreadCount),
  )

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        data-testid="notification-bell"
        aria-label={bellAria}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        <BellIcon className="h-5 w-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            className="absolute -top-1 -end-1 inline-flex min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-4 text-white"
            role="status"
          >
            {badgeLabel}
          </span>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        className="w-96 max-w-[90vw]"
        data-testid="notification-panel"
      >
        <div className="flex items-center justify-between px-1.5 py-1">
          <span className="text-sm font-medium text-gray-900">
            {t('notifications.bellLabel', locale)}
          </span>
          <button
            type="button"
            onClick={handleMarkAll}
            className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-primary hover:bg-primary/5 disabled:opacity-50"
            disabled={unreadCount === 0}
          >
            <CheckCheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {t('notifications.markAllRead', locale)}
          </button>
        </div>
        <DropdownMenuSeparator />

        {loading ? (
          <div className="space-y-3 p-2" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 animate-pulse">
                <div className="h-9 w-9 rounded-full bg-gray-200" />
                <div className="flex-1 space-y-2 py-0.5">
                  <div className="h-3 w-3/4 rounded bg-gray-200" />
                  <div className="h-3 w-1/2 rounded bg-gray-100" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <p className="p-3 text-sm text-red-600">{error}</p>
        ) : items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-gray-500">
            {t('notifications.empty.title', locale)}
          </p>
        ) : (
          <ul className="max-h-80 overflow-y-auto p-1">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => handleItemClick(item)}
                  className="flex w-full items-start gap-3 rounded-md px-1.5 py-2 text-start hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  dir={locale === 'fa' ? 'rtl' : 'ltr'}
                >
                  <NotificationRow
                    item={item}
                    locale={locale}
                    unread={!item.isRead}
                  />
                </button>
              </li>
            ))}
          </ul>
        )}

        <DropdownMenuSeparator />
        <div className="px-1.5 py-1">
          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="block rounded-md px-1.5 py-1.5 text-center text-sm font-medium text-primary hover:bg-primary/5"
          >
            {t('notifications.viewAll', locale)}
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}