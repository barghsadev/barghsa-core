import type { Locale } from '@barghsa/i18n/app';

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
