import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, type NavigateOptions } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/workspace';
import { BellIcon, CheckCheckIcon } from 'lucide-react';
import {
  LoadingSkeleton,
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
} from '@barghsa/ui';
import { useNotificationAccessDenied } from '../hooks/useNotificationAccessDenied.js';
import { useLocale } from '../hooks/useLocale.js';
import { useUnreadCount } from '../hooks/useUnreadCount.js';
import { useUnreadDocumentTitle } from '../hooks/useUnreadDocumentTitle.js';
import {
  fetchNotifications,
  isNotificationDenied,
  markOneRead,
  markAllRead,
  toNavigationTarget,
  type NotificationItem,
} from '../lib/notifications.js';
const NotificationRow = lazy(() =>
  import('./NotificationRow.js').then((module) => ({ default: module.NotificationRow }))
);

const DROPDOWN_SIZE = 10;

/**
 * Header notification bell (E-05, T-05.02.03 / T-05.02.04).
 *
 * A bell icon with an unread-count badge that opens a popover showing the
 * latest notifications plus quick actions ("mark all read", "view all"). Each
 * item is marked read on click and navigates to its linked record when one is
 * set. The badge is kept real-time by a 30s short-poll (T-05.02.04), read
 * actions update the count optimistically, and the unread count is mirrored
 * into the document title while the tab is backgrounded. Supports RTL and
 * shows a loading skeleton and empty state.
 */
export function NotificationBell({
  operatingContext = 'customer',
}: {
  operatingContext?: 'staff' | 'customer';
}) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<'read' | 'write' | null>(null);
  const [denied, setDenied] = useState(false),
    [acceptedContext, setAcceptedContext] = useState<string | null>(null);
  const liveContext = useRef(operatingContext);
  liveContext.current = operatingContext;
  const onCountDenied = useRef(() => {});
  const [writing, setWriting] = useState(false);
  const writingRef = useRef(false);
  const requestVersion = useRef(0);

  const { unreadCount, setUnreadCount, optimisticDecrement } = useUnreadCount(undefined, {
    enabled: !denied,
    onDenied: () => onCountDenied.current(),
  });
  const clearDenied = useCallback(() => {
    requestVersion.current++;
    writingRef.current = false;
    setWriting(false);
    setItems([]);
    setUnreadCount(0);
    setAcceptedContext(null);
    setDenied(true);
    setLoading(false);
    setError('read');
  }, [setUnreadCount]);
  const deny = useNotificationAccessDenied(operatingContext, clearDenied);
  onCountDenied.current = deny;

  // Mirror the unread count into the tab title while it is backgrounded.
  useUnreadDocumentTitle(unreadCount, numbers.number(unreadCount, { useGrouping: false }));

  const load = useCallback(async () => {
    if (writingRef.current) return;
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const page = await fetchNotifications(undefined, 'all', DROPDOWN_SIZE);
      if (requestVersion.current !== version || liveContext.current !== operatingContext) return;
      setItems(page.data);
      setAcceptedContext(operatingContext);
      setDenied(false);
      setUnreadCount(page.unread_count);
      setError(null);
    } catch (failure) {
      if (requestVersion.current !== version || liveContext.current !== operatingContext) return;
      if (isNotificationDenied(failure)) deny();
      else setError('read');
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  }, [operatingContext, setUnreadCount, deny]);

  // Load once on mount so the badge is accurate before the dropdown is opened.
  useEffect(() => {
    setWriting(false);
    setItems([]);
    setUnreadCount(0);
    setAcceptedContext(null);
    setDenied(false);
    setError(null);
    void load();
    return () => {
      requestVersion.current++;
      writingRef.current = false;
    };
  }, [load]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) void load();
  };

  const markRead = async (item?: NotificationItem) => {
    if (writingRef.current || loading || error || denied || acceptedContext !== operatingContext)
      return;
    const target = item ? toNavigationTarget(item, operatingContext) : null;
    const version = ++requestVersion.current;
    const previousItems = items;
    const previousCount = unreadCount;
    writingRef.current = true;
    setWriting(true);
    setLoading(false);
    setError(null);
    optimisticDecrement(item ? Number(!item.isRead) : unreadCount);
    setItems((prev) =>
      prev.map((row) => (!item || row.id === item.id ? { ...row, isRead: true } : row))
    );
    try {
      const count = item
        ? item.isRead
          ? unreadCount
          : await markOneRead(item.id)
        : await markAllRead();
      if (requestVersion.current !== version || liveContext.current !== operatingContext) return;
      setUnreadCount(count);
    } catch (failure) {
      if (requestVersion.current !== version || liveContext.current !== operatingContext) return;
      if (isNotificationDenied(failure)) {
        deny();
        return;
      }
      setItems(previousItems);
      setUnreadCount(previousCount);
      setError('write');
      return;
    } finally {
      if (requestVersion.current === version) {
        writingRef.current = false;
        setWriting(false);
      }
    }
    if (requestVersion.current !== version || liveContext.current !== operatingContext) return;
    if (target)
      navigate({
        to: target.to,
        search: target.search as NavigateOptions['search'],
      } as NavigateOptions);
    if (item && target) setOpen(false);
  };

  const badgeLabel = unreadCount > 99 ? `${numbers.number(99)}+` : numbers.number(unreadCount);
  const bellAria = t('notifications.bellAria', locale).replace(
    '{count}',
    numbers.number(unreadCount)
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        data-testid="notification-bell"
        aria-label={bellAria}
        className="relative inline-flex size-11 items-center justify-center rounded-lg border border-border bg-card text-card-foreground text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        <BellIcon className="h-5 w-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            className="absolute -top-1 -end-1 inline-flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground"
            role="status"
          >
            {badgeLabel}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent align="start" className="w-96 max-w-[90vw]" data-testid="notification-panel">
        <div className="flex items-center justify-between px-1.5 py-1">
          <PopoverTitle className="text-sm font-medium text-foreground">
            {t('notifications.bellLabel', locale)}
          </PopoverTitle>
          <button
            type="button"
            tabIndex={0}
            onClick={() => void markRead()}
            className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-foreground hover:bg-primary/5 disabled:opacity-50"
            disabled={
              unreadCount === 0 ||
              writing ||
              loading ||
              !!error ||
              denied ||
              acceptedContext !== operatingContext
            }
          >
            <CheckCheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {t('notifications.markAllRead', locale)}
          </button>
        </div>
        <hr className="my-1 border-border" />

        {loading && (
          <div className="p-3">
            <LoadingSkeleton label={t('notifications.loading', locale)} variant="table" />
          </div>
        )}
        {error && (
          <div className="p-3 text-sm text-destructive" role="alert">
            <p>
              {t(
                denied
                  ? 'notifications.error.denied'
                  : error === 'write'
                    ? 'notifications.error.write'
                    : 'notifications.error.load',
                locale
              )}
            </p>
            <button
              type="button"
              tabIndex={0}
              disabled={loading || writing}
              onClick={() => void load()}
              className="mt-2 underline"
            >
              {t('notifications.retry', locale)}
            </button>
          </div>
        )}
        {acceptedContext === operatingContext && items.length > 0 && (
          <ul className="max-h-80 overflow-y-auto p-1">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  tabIndex={0}
                  onClick={() => void markRead(item)}
                  disabled={
                    writing || loading || !!error || denied || acceptedContext !== operatingContext
                  }
                  className="flex w-full items-start gap-3 rounded-md px-1.5 py-2 text-start hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  dir={locale === 'fa' ? 'rtl' : 'ltr'}
                >
                  <Suspense
                    fallback={<span role="status">{t('notifications.loading', locale)}</span>}
                  >
                    <NotificationRow
                      item={item}
                      locale={locale}
                      unread={!item.isRead}
                      operatingContext={operatingContext}
                    />
                  </Suspense>
                </button>
              </li>
            ))}
          </ul>
        )}
        {!loading && !error && acceptedContext === operatingContext && items.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {t('notifications.empty.title', locale)}
          </p>
        )}

        <hr className="my-1 border-border" />
        <div className="px-1.5 py-1">
          <Link
            tabIndex={0}
            to={operatingContext === 'staff' ? '/admin/inbox' : '/notifications'}
            onClick={() => setOpen(false)}
            className="block rounded-md px-1.5 py-1.5 text-center text-sm font-medium text-foreground hover:bg-primary/5"
          >
            {t('notifications.viewAll', locale)}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
