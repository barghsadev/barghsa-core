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
  /** IANA zone for both display and selection; omit for legacy browser-local dates. */
  timezone?: string;
  /** Inclusive calendar-day limits. Existing values are never silently changed. */
  minDate?: Date;
  maxDate?: Date;
  disabled?: boolean;
  error?: string;
  placeholder?: string;
  className?: string;
  id?: string;
  label?: string;
}

interface DatePickerSingleProps extends DatePickerBaseProps {
  calendarMode?: 'single';
  value?: Date;
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
  timezone,
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
    if (!timezone) return jalaliCalendar;
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
    (instant: Date) => {
      const date = timezone ? new TZDate(instant.getTime(), timezone) : instant;
      if (jalali) {
        return jalaliFormat(date, 'yyyy/MM/dd', { locale: jalaliLocale });
      }
      return dateFnsFormat(date, 'yyyy/MM/dd');
    },
    [jalali, timezone]
  );

  const formatRange = React.useCallback(
    (range: DateRange) => {
      if (!range.from) return '';
      if (!range.to) return formatDate(range.from);
      return `${formatDate(range.from)} - ${formatDate(range.to)} ${jalali ? '(پایان بازه شامل نمی‌شود)' : '(end excluded)'}`;
    },
    [formatDate, jalali]
  );

  const dayStart = (date: Date) =>
    startOfDay(timezone ? new TZDate(date.getTime(), timezone) : date);
  const interval = calendarMode === 'range' ? (value as DateRange | undefined) : undefined;
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
              'w-full justify-start gap-2 text-start font-normal',
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
            numerals={jalali ? 'arabext' : 'latn'}
            locale={calendarLocale}
            defaultMonth={value ? (value as DateRange).from : undefined}
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
            numerals={jalali ? 'arabext' : 'latn'}
            locale={calendarLocale}
            defaultMonth={value as Date | undefined}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

export { DatePicker };
export type { DatePickerProps, DatePickerSingleProps, DatePickerRangeProps };
