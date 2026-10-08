import { t, type Locale } from '@barghsa/i18n/app';
import { interpolate, type NotificationItem } from './notifications.js';

export function notificationContent(
  item: NotificationItem,
  locale: Locale
): { title: string; body: string } {
  return (
    item.localizedContent?.[locale] ??
    item.localizedContent?.original ?? {
      title: interpolate(t(item.titleI18nKey, locale), item.params),
      body: interpolate(t(item.bodyI18nKey, locale), item.params),
    }
  );
}
