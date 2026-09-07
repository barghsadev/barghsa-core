import { formatInTimezone } from '@barghsa/i18n/date-time';
import { timezoneText } from '@barghsa/i18n/timezone';
import { useLocale } from './useLocale.js';
import { useTimezone } from './useTimezone.js';

/** One account preference read per screen, shared by every timestamp on that screen. */
export function useAccountTime() {
  const locale = useLocale();
  const zone = useTimezone();
  const format = (value: string | Date | number | null, options?: Intl.DateTimeFormatOptions) => {
    if (value === null) return '—';
    if (zone.status !== 'ready') return timezoneText('display.pending', locale);
    try {
      return formatInTimezone(value, zone.timezone, locale, options);
    } catch {
      return timezoneText('display.invalid', locale);
    }
  };
  const notice =
    zone.status === 'error' ? (
      <p role="alert">
        {timezoneText('error.load', locale)}{' '}
        <button type="button" onClick={zone.retry}>
          {timezoneText('retry', locale)}
        </button>
      </p>
    ) : null;
  return { ...zone, format, notice };
}
