import { useCallback, useEffect, useState } from 'react'
import { useNavigate, type NavigateOptions } from '@tanstack/react-router'
import { t } from '@barghsa/i18n'
import {
  BellIcon,
  CheckCheckIcon,
  Loader2Icon,
  InboxIcon,
} from 'lucide-react'
import { Button } from '@barghsa/ui'
import { useLocale } from '../hooks/useLocale.js'
import {
  fetchNotifications,
  markOneRead,
  markAllRead,
  toNavigationTarget,
  type NotificationFilter,
  type NotificationItem,
} from '../lib/notifications.js'
import { NotificationRow } from '../components/NotificationRow.js'

const PAGE_SIZE = 20

/**
 * Notification center page (E-05, T-05.02.03).
 *
 * Full, cursor-paginated list of the active profile's notifications with an
 * "unread only" filter and a "mark all read" action. Each item marks itself
 * read on click and navigates to its linked record when one is set. Shows a
 * loading skeleton, an empty state, and a load-more footer. RTL-aware.
 */
export function NotificationCenterPage() {
  const locale = useLocale()
  const navigate = useNavigate()

  const [items, setItems] = useState<NotificationItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const [filter, setFilter] = useState<NotificationFilter>('all')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)

  const load = useCallback(
    async (cursor?: string, currentFilter: NotificationFilter = filter) => {
      try {
        const page = await fetchNotifications(cursor, currentFilter, PAGE_SIZE)
        setItems((prev) => (cursor ? [...prev, ...page.data] : [...page.data]))
        setNextCursor(page.next_cursor)
        setUnreadCount(page.unread_count)
        setError(null)
      } catch {
        setError(t('notifications.error.load', locale))
      }
    },
    [filter, locale],
  )

  useEffect(() => {
    setLoading(true)
    setItems([])
    setNextCursor(null)
    void load(undefined, filter).finally(() => setLoading(false))
  }, [filter, load])

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      await load(nextCursor)
    } finally {
      setLoadingMore(false)
    }
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
        // Non-blocking; navigation proceeds if a route exists.
      }
    }
    if (target) {
      navigate({
        to: target.to,
        search: target.search as NavigateOptions['search'],
      } as NavigateOptions)
    }
  }

  const handleMarkAll = async () => {
    setMarkingAll(true)
    try {
      const count = await markAllRead()
      setUnreadCount(count)
      setItems((prev) => prev.map((i) => ({ ...i, isRead: true })))
    } catch {
      setError(t('notifications.error.load', locale))
    } finally {
      setMarkingAll(false)
    }
  }

  const isRtl = locale === 'fa'

  return (
    <div className="mx-auto max-w-3xl space-y-5" dir={isRtl ? 'rtl' : 'ltr'}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BellIcon className="h-6 w-6 text-primary" aria-hidden="true" />
          <h1 className="text-2xl font-bold text-gray-900">
            {t('notifications.title', locale)}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleMarkAll}
            disabled={unreadCount === 0 || markingAll}
            className="gap-2"
          >
            {markingAll ? (
              <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <CheckCheckIcon className="h-4 w-4" aria-hidden="true" />
            )}
            {t('notifications.markAllRead', locale)}
          </Button>
        </div>
      </header>

      {/* Filter toggle */}
      <div role="tablist" aria-label={t('notifications.bellLabel', locale)} className="flex gap-1 rounded-lg bg-gray-100 p-1 text-sm">
        {(['all', 'unread'] as NotificationFilter[]).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            onClick={() => setFilter(value)}
            className={`flex-1 rounded-md px-3 py-1.5 transition-colors ${
              filter === value
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {value === 'all'
              ? t('notifications.bellLabel', locale)
              : t('notifications.unread', locale)}
          </button>
        ))}
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 animate-pulse">
              <div className="h-10 w-10 rounded-full bg-gray-200" />
              <div className="flex-1 space-y-2 py-0.5">
                <div className="h-3 w-3/4 rounded bg-gray-200" />
                <div className="h-3 w-1/2 rounded bg-gray-100" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && items.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-10 text-center">
          <InboxIcon className="mx-auto h-10 w-10 text-gray-300" aria-hidden="true" />
          <h2 className="mt-3 text-lg font-semibold text-gray-900">
            {filter === 'unread'
              ? t('notifications.empty.unread', locale)
              : t('notifications.empty.title', locale)}
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {t('notifications.empty.body', locale)}
          </p>
        </div>
      )}

      {/* List */}
      {!loading && !error && items.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => handleItemClick(item)}
                className="flex w-full items-start gap-3 px-4 py-3 text-start transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                dir={isRtl ? 'rtl' : 'ltr'}
                aria-label={`${t('notifications.markReadAria', locale)} — ${t(
                  item.titleI18nKey,
                  locale,
                )}`}
              >
                <span className={item.isRead ? 'opacity-70' : ''}>
                  <NotificationRow
                    item={item}
                    locale={locale}
                    unread={!item.isRead}
                    muted={item.isRead}
                  />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Load more */}
      {!loading && !error && nextCursor && (
        <div className="text-center">
          <Button
            variant="outline"
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="gap-2"
          >
            {loadingMore && (
              <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            {t('notifications.loadMore', locale)}
          </Button>
        </div>
      )}
    </div>
  )
}