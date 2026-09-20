'use client';

import * as React from 'react';
import * as jalaliCalendar from 'date-fns-jalali';
import { addDays, startOfDay, format as dateFnsFormat } from 'date-fns';
import { format as jalaliFormat } from 'date-fns-jalali';
import { faIR as jalaliLocale } from 'date-fns-jalali/locale';
import { CalendarIcon } from 'lucide-react';
import { TZDate, type DateRange, type Locale } from 'react-day-picker';
import { faIR as dayPickerPersian } from 'react-day-picker/locale/fa-IR';

import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Calendar } from '../ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

type CalendarMode = 'single' | 'range';

interface DatePickerBaseProps {
  calendarMode?: CalendarMode;
  /** Prefer locale; jalali remains supported for existing callers. */
  jalali?: boolean;
  locale?: 'fa' | 'en';
  /** IANA zone for display and selection. Defaults to Iran. */
  timezone?: string;
  numerals?: 'arabext' | 'latn';
  /** Inclusive calendar-day limits. Existing values are never silently changed. */
  minDate?: Date | undefined;
  maxDate?: Date | undefined;
  disabled?: boolean;
  error?: string;
  placeholder?: string;
  className?: string;
  id?: string;
  label?: string;
}

interface DatePickerSingleProps extends DatePickerBaseProps {
  calendarMode?: 'single';
  value?: Date | undefined;
  onChange?: (date: Date | undefined) => void;
}

interface DatePickerRangeProps extends DatePickerBaseProps {
  calendarMode: 'range';
  /** Half-open interval: from is included, to is the first excluded day. */
  value?: DateRange;
  onChange?: (range: DateRange | undefined) => void;
}

type DatePickerProps = DatePickerSingleProps | DatePickerRangeProps;

function DatePicker({
  calendarMode = 'single',
  jalali: jalaliOverride,
  locale,
  timezone = 'Asia/Tehran',
  numerals: numeralOverride,
  minDate,
  maxDate,
  disabled = false,
  error,
  placeholder,
  className,
  value,
  onChange,
  id,
  label,
  ...props
}: DatePickerProps & Omit<React.ComponentProps<typeof Popover>, 'children'>) {
  const [open, setOpen] = React.useState(false);
  const errorId = React.useId();
  const jalali = locale ? locale === 'fa' : (jalaliOverride ?? true);
  const numerals = numeralOverride ?? (jalali ? 'arabext' : 'latn');
  const prompt = placeholder ?? (jalali ? 'انتخاب تاریخ' : 'Select date');
  const disabledDays = [
    ...(minDate ? [{ before: minDate }] : []),
    ...(maxDate ? [{ after: maxDate }] : []),
  ];
  // Keep calendar initialization inside its component so importing other UI
  // controls does not retain the date libraries in unrelated route bundles.
  const calendarLocale = React.useMemo(
    () =>
      jalali
        ? ({ ...jalaliLocale, labels: dayPickerPersian.labels } as unknown as Locale)
        : undefined,
    [jalali]
  );

  const calendarDateLib = React.useMemo(() => {
    if (!jalali) return undefined;
    return {
      ...jalaliCalendar,
      // The Jalali library's constructor creates browser-local dates. Translate
      // calendar fields before constructing midnight in the requested zone.
      newDate: (year: number, month: number, day: number) => {
        const gregorian = jalaliCalendar.newDate(year, month, day, 12);
        return new TZDate(
          gregorian.getFullYear(),
          gregorian.getMonth(),
          gregorian.getDate(),
          timezone
        );
      },
    };
  }, [jalali, timezone]);

  const formatDate = React.useCallback(
    (date: Date) => {
      const formatter = new Intl.DateTimeFormat(jalali ? 'fa-IR' : 'en-US', {
        calendar: jalali ? 'persian' : 'gregory',
        numberingSystem: numerals,
        timeZone: timezone,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      if (!jalali) return formatter.format(date);
      const parts = formatter.formatToParts(date);
      const part = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((item) => item.type === type)?.value ?? '';
      const fullDate = `${part('weekday')}، ${part('day')} ${part('month')} ${part('year')}`;
      const gregorianYear = new Intl.DateTimeFormat('en-US', {
        calendar: 'gregory',
        numberingSystem: numerals,
        timeZone: timezone,
        year: 'numeric',
      }).format(date);
      return `${fullDate} (${gregorianYear})`;
    },
    [jalali, timezone, numerals]
  );

  const calendarFormatters = {
    formatMonthDropdown: (date: Date) =>
      jalali ? jalaliFormat(date, 'LLLL', { locale: jalaliLocale }) : dateFnsFormat(date, 'LLLL'),
    formatYearDropdown: (date: Date) => {
      const years = jalali
        ? `${jalaliFormat(date, 'yyyy')} / ${dateFnsFormat(date, 'yyyy')}`
        : dateFnsFormat(date, 'yyyy');
      return numerals === 'arabext'
        ? years.replace(/[0-9]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]!)
        : years;
    },
  };

  const formatRange = React.useCallback(
    (range: DateRange) => {
      if (!range.from) return '';
      if (!range.to) return formatDate(range.from);
      return `${formatDate(range.from)} - ${formatDate(range.to)} ${jalali ? '(پایان بازه شامل نمی‌شود)' : '(end excluded)'}`;
    },
    [formatDate, jalali]
  );

  const dayStart = (date: Date) => startOfDay(new TZDate(date.getTime(), timezone));
  const interval = calendarMode === 'range' ? (value as DateRange | undefined) : undefined;
  const defaultMonth = calendarMode === 'range' ? interval?.from : (value as Date | undefined);
  const calendarRange = interval
    ? {
        from: interval.from && dayStart(interval.from),
        to: interval.to ? addDays(dayStart(interval.to), -1) : undefined,
      }
    : undefined;

  const displayValue = React.useMemo(() => {
    if (!value) return undefined;
    if (calendarMode === 'range') {
      return formatRange(value as DateRange);
    }
    return formatDate(value as Date);
  }, [value, calendarMode, formatDate, formatRange]);

  return (
    <Popover open={open && !disabled} onOpenChange={setOpen} {...props}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            aria-label={label ?? prompt}
            aria-haspopup="dialog"
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            disabled={disabled}
            variant="outline"
            role="combobox"
            aria-expanded={open && !disabled}
            className={cn(
              'h-auto min-h-8 w-full justify-start gap-2 text-start font-normal',
              !value && 'text-muted-foreground',
              className
            )}
          >
            <CalendarIcon className="size-4 shrink-0" />
            {displayValue ? (
              <span className="whitespace-normal">{displayValue}</span>
            ) : (
              <span className="text-muted-foreground">{prompt}</span>
            )}
          </Button>
        }
      />
      {error && (
        <span id={errorId} className="text-sm text-destructive">
          {error}
        </span>
      )}
      <PopoverContent className="w-auto p-0" align="start" aria-label={label ?? prompt}>
        {calendarMode === 'range' ? (
          <Calendar
            mode="range"
            selected={calendarRange}
            onSelect={(range) => {
              (onChange as (range: DateRange | undefined) => void)?.(
                range
                  ? {
                      from: range.from && dayStart(range.from),
                      to: range.to ? addDays(dayStart(range.to), 1) : undefined,
                    }
                  : undefined
              );
            }}
            disabled={disabledDays}
            dateLib={calendarDateLib}
            timeZone={timezone}
            dir={jalali ? 'rtl' : 'ltr'}
            numerals={numerals}
            captionLayout="dropdown-months"
            formatters={calendarFormatters}
            locale={calendarLocale}
            {...(defaultMonth ? { defaultMonth } : {})}
          />
        ) : (
          <Calendar
            mode="single"
            selected={value as Date | undefined}
            onSelect={(date) => {
              (onChange as (date: Date | undefined) => void)?.(date);
              setOpen(false);
            }}
            disabled={disabledDays}
            dateLib={calendarDateLib}
            timeZone={timezone}
            dir={jalali ? 'rtl' : 'ltr'}
            numerals={numerals}
            captionLayout="dropdown-months"
            formatters={calendarFormatters}
            locale={calendarLocale}
            {...(defaultMonth ? { defaultMonth } : {})}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Inclusive timestamp bounds for APIs that accept an inclusive `to` filter. */
function datePickerDayBounds(date: Date, timezone: string): { start: Date; end: Date } {
  const start = startOfDay(new TZDate(date.getTime(), timezone));
  return { start: new Date(start.getTime()), end: new Date(addDays(start, 1).getTime() - 1) };
}

/** Resolve wall-clock input in the account zone, rejecting invalid or skipped times. */
function datePickerAtTime(
  date: Date,
  hours: number,
  minutes: number,
  timezone: string
): Date | undefined {
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  )
    return undefined;
  const value = new TZDate(date.getTime(), timezone);
  const day = value.getDate();
  value.setHours(hours, minutes, 0, 0);
  if (value.getDate() !== day || value.getHours() !== hours || value.getMinutes() !== minutes)
    return undefined;
  return new Date(value.getTime());
}

/** Convert a Gregorian date-only filter into noon in its account timezone. */
function datePickerCalendarDate(value: string, timezone: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]),
    month = Number(match[2]) - 1,
    day = Number(match[3]);
  const date = new TZDate(0, timezone);
  date.setFullYear(year, month, day);
  date.setHours(12, 0, 0, 0);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
    ? date
    : undefined;
}

export { DatePicker, datePickerDayBounds, datePickerAtTime, datePickerCalendarDate };
export type { DatePickerProps, DatePickerSingleProps, DatePickerRangeProps };
