/** Format UTC instants in an explicit account timezone, never the host timezone. */
export function formatInTimezone(
  utcDate: string | number | Date,
  timezone = 'Asia/Tehran',
  locale: 'en' | 'fa' = 'en',
  format: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }
): string {
  if (typeof utcDate === 'string' && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(utcDate))
    throw new RangeError('A timestamp with an explicit UTC offset is required');
  const date = new Date(utcDate);
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid timestamp');
  return new Intl.DateTimeFormat(locale, { ...format, timeZone: timezone }).format(date);
}

export function formatTime(
  utcDate: string | number | Date,
  timezone = 'Asia/Tehran',
  locale: 'en' | 'fa' = 'en'
): string {
  return formatInTimezone(utcDate, timezone, locale, { timeStyle: 'short' });
}

export function formatDate(
  utcDate: string | number | Date,
  timezone = 'Asia/Tehran',
  locale: 'en' | 'fa' = 'en'
): string {
  return formatInTimezone(utcDate, timezone, locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}
