import { TZDate } from '@date-fns/tz';
import {
  addDays as gregorianAddDays,
  addMonths as gregorianAddMonths,
  format as gregorianFormat,
  parse as gregorianParse,
  startOfMonth as gregorianStartOfMonth,
} from 'date-fns';
import { enUS } from 'date-fns/locale/en-US';
import {
  addDays as persianAddDays,
  addMonths as persianAddMonths,
  format as persianFormat,
  getDaysInMonth as persianGetDaysInMonth,
  parse as persianParse,
  startOfMonth as persianStartOfMonth,
} from 'date-fns-jalali';
import { faIR } from 'date-fns-jalali/locale/fa-IR';

export type CalendarLocale = 'fa' | 'en';
export type CalendarInstant = string | number | Date;
const defaultTimezone = 'Asia/Tehran';

/** Date-only strings and local timestamps cannot identify an instant. */
export function calendarInstant(value: CalendarInstant): Date {
  if (typeof value === 'string' && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value))
    throw new RangeError('An explicit UTC offset is required');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid timestamp');
  return date;
}

const latinDigits = (value: string) =>
  value.replace(/[۰-۹٠-٩]/g, (digit) =>
    String(digit.charCodeAt(0) - (digit >= '۰' ? 0x06f0 : 0x0660))
  );

/** Calendar operations are display/input adapters, never billing-period authority. */
export function createCalendar(locale: CalendarLocale = 'fa', timezone = defaultTimezone) {
  // An invalid account zone must not silently become the host zone.
  new Intl.DateTimeFormat('en', { timeZone: timezone });
  const persian = locale === 'fa';
  const formatDate = persian ? persianFormat : gregorianFormat;
  const parseDate = persian ? persianParse : gregorianParse;
  const addDateDays = persian ? persianAddDays : gregorianAddDays;
  const addDateMonths = persian ? persianAddMonths : gregorianAddMonths;
  const monthStart = persian ? persianStartOfMonth : gregorianStartOfMonth;
  const options = { locale: persian ? faIR : enUS };
  const zoned = (value: CalendarInstant) => new TZDate(calendarInstant(value).getTime(), timezone);
  const integer = (value: number) => {
    if (!Number.isInteger(value)) throw new RangeError('An integer calendar offset is required');
    return value;
  };
  const displayDigits = (value: string) =>
    persian ? value.replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]!) : value;

  return {
    calendar: persian ? ('persian' as const) : ('gregory' as const),
    locale,
    timezone,
    format: (value: CalendarInstant, pattern = 'P') =>
      displayDigits(formatDate(zoned(value), pattern, options)),
    parse: (value: string, pattern = 'P', reference: CalendarInstant = Date.now()): Date | null => {
      const input = latinDigits(value);
      try {
        const parsed = parseDate(input, pattern, zoned(reference), options);
        if (
          !Number.isFinite(parsed.getTime()) ||
          latinDigits(formatDate(parsed, pattern, options)) !== input
        )
          return null;
        return new Date(parsed.getTime());
      } catch {
        return null;
      }
    },
    addDays: (value: CalendarInstant, days: number) =>
      new Date(addDateDays(zoned(value), integer(days)).getTime()),
    addMonths: (value: CalendarInstant, months: number) =>
      new Date(addDateMonths(zoned(value), integer(months)).getTime()),
    startOfMonth: (value: CalendarInstant) => new Date(monthStart(zoned(value)).getTime()),
  };
}

/** Convert an instant to its Tehran civil date in the Jalali calendar. */
export function toJalali(value: Date): { year: number; month: number; day: number } {
  const [year, month, day] = latinDigits(createCalendar().format(value, 'yyyy/MM/dd'))
    .split('/')
    .map(Number);
  return { year: year!, month: month!, day: day! };
}

/** Convert a valid Jalali civil date to the instant at the start of its Tehran day. */
export function toGregorian(year: number, month: number, day: number): Date {
  if (![year, month, day].every((value) => Number.isInteger(value) && value > 0))
    throw new RangeError('Invalid Jalali date');
  const input = `${String(year).padStart(4, '0')}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
  const date = createCalendar().parse(input, 'yyyy/MM/dd', 0);
  if (!date) throw new RangeError('Invalid Jalali date');
  return date;
}

export function getJalaliMonthDays(year: number, month: number): number {
  const start = toGregorian(year, month, 1);
  return persianGetDaysInMonth(new TZDate(start.getTime(), defaultTimezone));
}

export function formatDate(
  value: CalendarInstant,
  locale: CalendarLocale = 'fa',
  pattern = 'P'
): string {
  return createCalendar(locale).format(value, pattern);
}

const periodSeparator = { fa: ' تا ', en: ' to ' };
export function formatPeriod(
  start: CalendarInstant,
  end: CalendarInstant,
  locale: CalendarLocale = 'fa'
): string {
  const calendar = createCalendar(locale);
  return [calendar.format(start, 'yyyy/MM/dd'), calendar.format(end, 'yyyy/MM/dd')].join(
    periodSeparator[locale]
  );
}

const relativeMessages = {
  fa: { justNow: 'لحظاتی پیش', soon: 'لحظاتی دیگر' },
  en: { justNow: 'Just now', soon: 'In a few moments' },
};
const relativeUnits = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
] as const;

export function calendarRelativeTime(
  value: CalendarInstant,
  locale: CalendarLocale,
  now: CalendarInstant = Date.now()
): string {
  const seconds = (calendarInstant(value).getTime() - calendarInstant(now).getTime()) / 1_000;
  if (Math.abs(seconds) < 30) return relativeMessages[locale][seconds > 0 ? 'soon' : 'justNow'];
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, duration] of relativeUnits)
    if (Math.abs(seconds) >= duration)
      return formatter.format(Math.round(seconds / duration), unit);
  return formatter.format(Math.round(seconds), 'second');
}

export { calendarRelativeTime as formatRelative };
