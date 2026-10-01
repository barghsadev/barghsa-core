import { t, type Locale } from '@barghsa/i18n/app';
import {
  notificationContent,
  formatRelativeTime,
  toNavigationTarget,
  type NotificationItem,
} from '../lib/notifications.js';
import { NotificationStatusBadge } from './NotificationStatusBadge.js';

/**
 * A single notification row (shared by the header bell dropdown and the full
 * notification center page). Renders the per-type icon, interpolated title and
 * body, a relative-time stamp, and an unread indicator.
 *
 * The clickable wrapper (Link / button / dropdown item) is provided by the
 * caller, so the same presentational row adapts to each surface without
 * duplicating markup.
 */
export function NotificationRow({
  item,
  locale,
  unread,
  muted = false,
  operatingContext = 'customer',
}: {
  item: NotificationItem;
  locale: Locale;
  /** Force the unread dot on/off (e.g. after an optimistic mark-read). */
  unread: boolean;
  /** Reduce visual weight for already-read or compact surfaces. */
  muted?: boolean;
  operatingContext?: 'staff' | 'customer';
}) {
  const { title, body } = notificationContent(item, locale);
  const timeLabel = formatRelativeTime(item.createdAt, locale);
  const isRtl = locale === 'fa';
  const customerLinkInStaffMode =
    operatingContext === 'staff' &&
    toNavigationTarget(item, 'staff') === null &&
    toNavigationTarget(item, 'customer') !== null;

  return (
    <div className="flex w-full items-start gap-3" dir={isRtl ? 'rtl' : 'ltr'}>
      <NotificationStatusBadge type={item.type} locale={locale} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={`truncate text-sm font-medium ${muted ? 'text-muted-foreground' : 'text-foreground'}`}
          >
            {title}
          </span>
          {unread && (
            <span
              className="h-2 w-2 shrink-0 rounded-full bg-primary"
              aria-label={t('notifications.unread', locale)}
              title={t('notifications.unread', locale)}
            />
          )}
        </span>
        <span className="mt-0.5 block [overflow-wrap:anywhere] text-xs leading-snug text-muted-foreground">
          {body}
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{timeLabel}</span>
        </span>
        {customerLinkInStaffMode && (
          <span className="mt-1 block text-xs text-muted-foreground">
            {t('notifications.customerContextLink', locale)}
          </span>
        )}
      </span>
    </div>
  );
}
