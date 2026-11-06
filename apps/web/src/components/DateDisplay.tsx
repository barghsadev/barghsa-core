import { useEffect, useState, type ComponentProps } from 'react';
import {
  calendarInstant,
  calendarRelativeTime,
  type CalendarInstant,
  type CalendarLocale,
} from '@barghsa/i18n/calendar';
import { timezoneText } from '@barghsa/i18n/timezone';
import { useCalendar } from '../hooks/useCalendar.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useLocale } from '../hooks/useLocale.js';

type TimestampProps = Omit<ComponentProps<'time'>, 'dateTime' | 'children' | 'ref'> & {
  date: CalendarInstant | null;
  locale?: CalendarLocale;
};
export type DateDisplayProps = TimestampProps & {
  format?: string;
  showTime?: boolean;
  /** Public views provide a zone; private views can use the accepted account preference. */
  timezone?: string;
};

function ZonedDateDisplay({
  date,
  format = 'P',
  showTime = false,
  timezone = 'Asia/Tehran',
  locale,
  ...props
}: DateDisplayProps) {
  const calendar = useCalendar(timezone, locale);
  try {
    if (date === null) return <span {...props}>—</span>;
    const instant = calendarInstant(date);
    const text = calendar.format(
      instant,
      showTime ? `${format} ${calendar.locale === 'fa' ? 'HH:mm' : 'p'}` : format
    );
    return (
      <time {...props} dateTime={instant.toISOString()} data-slot="date-display">
        {text}
      </time>
    );
  } catch {
    return <span {...props}>{timezoneText('display.invalid', calendar.locale)}</span>;
  }
}

function AccountDateDisplay(props: DateDisplayProps) {
  const time = useAccountTime(props.locale);
  const locale = useLocale();
  if (time.status !== 'ready')
    return (
      <>
        <span className={props.className} aria-busy={time.status === 'loading' || undefined}>
          {timezoneText('display.pending', props.locale ?? locale)}
        </span>
        {time.notice}
      </>
    );
  return <ZonedDateDisplay {...props} timezone={time.timezone} />;
}

function InvalidDateDisplay({
  date: _date,
  format: _format,
  showTime: _showTime,
  timezone: _timezone,
  locale: localeOverride,
  ...props
}: DateDisplayProps) {
  const locale = useLocale();
  return <span {...props}>{timezoneText('display.invalid', localeOverride ?? locale)}</span>;
}

export function DateDisplay(props: DateDisplayProps) {
  if (props.timezone) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: props.timezone });
    } catch {
      return <InvalidDateDisplay {...props} />;
    }
  }
  return props.timezone || props.date === null ? (
    <ZonedDateDisplay {...props} />
  ) : (
    <AccountDateDisplay {...props} />
  );
}

export function DateTimeDisplay(props: Omit<DateDisplayProps, 'showTime'>) {
  return <DateDisplay {...props} showTime />;
}

/** Relative labels update locally; this never polls a business resource or moves focus. */
export function RelativeTime({ date, locale: localeOverride, ...props }: TimestampProps) {
  const liveLocale = useLocale();
  const locale = localeOverride ?? liveLocale;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (date === null) return;
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, [date]);
  try {
    if (date === null) return <span {...props}>—</span>;
    const instant = calendarInstant(date);
    return (
      <time {...props} dateTime={instant.toISOString()} data-slot="relative-time">
        {calendarRelativeTime(instant, locale, now)}
      </time>
    );
  } catch {
    return <span {...props}>{timezoneText('display.invalid', locale)}</span>;
  }
}
