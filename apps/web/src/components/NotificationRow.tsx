import { t, type Locale } from '@barghsa/i18n/app';
import {
  ShieldAlertIcon,
  CreditCardIcon,
  FileTextIcon,
  PackageIcon,
  InfoIcon,
  type LucideIcon,
} from 'lucide-react';
import {
  notificationContent,
  formatRelativeTime,
  notificationTypeLabelKey,
  notificationDisplayType,
  type NotificationItem,
} from '../lib/notifications.js';

const TYPE_ICONS: Record<string, LucideIcon> = {
  security: ShieldAlertIcon,
  payment: CreditCardIcon,
  contract: FileTextIcon,
  order: PackageIcon,
};

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
}: {
  item: NotificationItem;
  locale: Locale;
  /** Force the unread dot on/off (e.g. after an optimistic mark-read). */
  unread: boolean;
  /** Reduce visual weight for already-read or compact surfaces. */
  muted?: boolean;
}) {
  const Icon = TYPE_ICONS[notificationDisplayType(item.type)] ?? InfoIcon;
  const { title, body } = notificationContent(item, locale);
  const typeLabel = t(notificationTypeLabelKey(item.type), locale);
  const timeLabel = formatRelativeTime(item.createdAt, locale);
  const isRtl = locale === 'fa';

  return (
    <div className="flex w-full items-start gap-3" dir={isRtl ? 'rtl' : 'ltr'}>
      <span
        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
          unread ? 'bg-primary/10 text-foreground' : 'bg-muted text-muted-foreground'
        }`}
        aria-hidden="true"
      >
        <Icon className="h-5 w-5" />
      </span>
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
        <span
          className={`mt-0.5 block text-xs leading-snug ${
            muted ? 'text-muted-foreground' : 'text-muted-foreground'
          }`}
        >
          {body}
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{timeLabel}</span>
          <span aria-hidden="true">·</span>
          <span>{typeLabel}</span>
        </span>
      </span>
    </div>
  );
}
