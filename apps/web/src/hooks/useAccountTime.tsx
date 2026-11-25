import type { Locale } from '@barghsa/i18n/app';
import { formatInTimezone } from '@barghsa/i18n/date-time';
import { timezoneDisplayText } from '@barghsa/i18n/timezone-display';
import { useLocale } from './useLocale.js';
import { useTimezone } from './useTimezone.js';

/** One account preference read per screen, shared by every timestamp on that screen. */
export function useAccountTime(localeOverride?: Locale, enabled = true) {
  const documentLocale = useLocale();
  const locale = localeOverride ?? documentLocale;
  const zone = useTimezone(enabled);
  const format = (value: string | Date | number | null, options?: Intl.DateTimeFormatOptions) => {
    if (value === null) return '—';
    if (zone.status !== 'ready') return timezoneDisplayText('display.pending', locale);
    try {
      return formatInTimezone(value, zone.timezone, locale, options);
    } catch {
      return timezoneDisplayText('display.invalid', locale);
    }
  };
  const notice =
    zone.status === 'error' ? (
      <p role="alert">
        {timezoneDisplayText('error.load', locale)}{' '}
        <button type="button" onClick={zone.retry}>
          {timezoneDisplayText('retry', locale)}
        </button>
      </p>
    ) : null;
  return { ...zone, format, notice };
}
