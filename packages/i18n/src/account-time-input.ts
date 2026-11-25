import { TZDate } from '@date-fns/tz';

const english = {
  time: 'Time',
  time24: 'Time in 24-hour format',
  manual: 'Enter manually',
  calendar: 'Use calendar',
  clear: 'Clear',
};
const persian: Record<keyof typeof english, string> = {
  time: 'ساعت',
  time24: 'ساعت با قالب ۲۴ ساعته',
  manual: 'ورود میلادی',
  calendar: 'تقویم شمسی',
  clear: 'پاک کردن',
};

export function accountTimeInputText(key: keyof typeof english, locale: 'en' | 'fa'): string {
  return (locale === 'fa' ? persian : english)[key];
}

/** Resolve a Gregorian datetime-local value in the account zone, rejecting skipped times. */
export function datetimeLocalToIso(value: string, timezone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const hours = Number(match[4]);
  const minutes = Number(match[5]);
  if (hours > 23 || minutes > 59) return null;
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
    const date = new TZDate(0, timezone);
    date.setFullYear(year, month, day);
    date.setHours(12, 0, 0, 0);
    if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day)
      return null;
    date.setHours(hours, minutes, 0, 0);
    return date.getDate() === day && date.getHours() === hours && date.getMinutes() === minutes
      ? new Date(date.getTime()).toISOString()
      : null;
  } catch {
    return null;
  }
}
