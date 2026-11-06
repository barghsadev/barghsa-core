import { useMemo } from 'react';
import { createCalendar, type CalendarLocale } from '@barghsa/i18n/calendar';
import { useLocale } from './useLocale.js';

/** Supply the accepted account zone when adapting private account dates. */
export function useCalendar(timezone = 'Asia/Tehran', localeOverride?: CalendarLocale) {
  const liveLocale = useLocale();
  const locale = localeOverride ?? liveLocale;
  return useMemo(() => createCalendar(locale, timezone), [locale, timezone]);
}
