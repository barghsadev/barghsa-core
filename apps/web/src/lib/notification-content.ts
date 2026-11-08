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

const RELATIVE_UNITS: Array<{
  unit: Intl.RelativeTimeFormatUnit;
  seconds: number;
}> = [
  { unit: 'year', seconds: 365 * 24 * 60 * 60 },
  { unit: 'month', seconds: 30 * 24 * 60 * 60 },
  { unit: 'week', seconds: 7 * 24 * 60 * 60 },
  { unit: 'day', seconds: 24 * 60 * 60 },
  { unit: 'hour', seconds: 60 * 60 },
  { unit: 'minute', seconds: 60 },
];

/** Format elapsed time for notification and ticket rows in the active locale. */
export function formatRelativeTime(
  date: string | Date,
  locale: Locale,
  now: Date = new Date()
): string {
  const target = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(target.getTime())) return '—';
  const diffSeconds = Math.floor((target.getTime() - now.getTime()) / 1000);

  if (diffSeconds > -30) return '';

  const abs = Math.abs(diffSeconds);
  const rtf = new Intl.RelativeTimeFormat(locale === 'fa' ? 'fa-IR' : 'en', { numeric: 'auto' });

  for (const { unit, seconds } of RELATIVE_UNITS) {
    if (abs >= seconds) {
      return rtf.format(Math.round(diffSeconds / seconds), unit);
    }
  }
  return rtf.format(Math.round(diffSeconds / 60), 'minute');
}
