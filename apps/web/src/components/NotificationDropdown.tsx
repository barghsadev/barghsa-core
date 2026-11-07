import { lazy, Suspense } from 'react';
import { Link } from '@tanstack/react-router';
import { CheckCheckIcon } from 'lucide-react';
import { PopoverTitle, LoadingSkeleton } from '@barghsa/ui';
import { t, type Locale } from '@barghsa/i18n/workspace';
import type { NotificationItem } from '../lib/notifications.js';
const NotificationRow = lazy(() =>
  import('./NotificationRow.js').then((module) => ({ default: module.NotificationRow }))
);

/** Display the current bell controller state; authority and commands remain with its owner. */
export default function NotificationDropdown({
  locale,
  unreadCount,
  writing,
  loading,
  error,
  denied,
  acceptedContext,
  operatingContext,
  items,
  markRead,
  load,
  onNavigate,
}: {
  locale: Locale;
  unreadCount: number;
  writing: boolean;
  loading: boolean;
  error: 'read' | 'write' | null;
  denied: boolean;
  acceptedContext: string | null;
  operatingContext: 'customer' | 'staff';
  items: NotificationItem[];
  markRead: (item?: NotificationItem) => Promise<void>;
  load: () => Promise<void>;
  onNavigate: () => void;
}) {
  return (
    <>
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
          onClick={onNavigate}
          className="block rounded-md px-1.5 py-1.5 text-center text-sm font-medium text-foreground hover:bg-primary/5"
        >
          {t('notifications.viewAll', locale)}
        </Link>
      </div>
    </>
  );
}
