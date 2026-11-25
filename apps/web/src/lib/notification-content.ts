import { t, type Locale } from '@barghsa/i18n/app';
import type { NotificationItem } from './notifications.js';

/** Render either supported placeholder syntax and preserve unknown placeholders. */
export function interpolate(template: string, params: Record<string, unknown> = {}): string {
  return template.replace(/\{\{?(\w+)\}?\}/g, (match, name: string) =>
    params[name] !== undefined && params[name] !== null ? String(params[name]) : match
  );
}

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
