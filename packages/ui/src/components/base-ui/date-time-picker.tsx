'use client';

import * as React from 'react';
import { TZDate } from 'react-day-picker';
import { DatePicker, datePickerAtTime, type DatePickerSingleProps } from './date-picker';

export interface DateTimePickerProps extends Omit<
  DatePickerSingleProps,
  'onChange' | 'jalali' | 'calendarMode'
> {
  onChange: (date: Date | undefined) => void;
}

/** A single instant displayed in the selected calendar and account timezone. */
function DateTimePicker({
  value,
  onChange,
  locale = 'fa',
  timezone = 'Asia/Tehran',
  label,
  id,
  disabled = false,
  ...datePickerProps
}: DateTimePickerProps) {
  const [invalidTime, setInvalidTime] = React.useState(false);
  const local = value ? new TZDate(value.getTime(), timezone) : undefined;
  const hour = local?.getHours() ?? 0;
  const minute = local?.getMinutes() ?? 0;
  const isPersian = locale === 'fa';
  const displayedHour = isPersian ? hour : hour % 12 || 12;
  const period = hour < 12 ? 'AM' : 'PM';
  const timeLabel = isPersian ? 'زمان' : 'Time';
  const hourLabel = isPersian ? 'ساعت' : 'Hour';
  const minuteLabel = isPersian ? 'دقیقه' : 'Minute';
  const selectClass = 'rounded-md border border-input bg-background px-2 py-1.5 text-sm';
  const clockNumber = (part: number) => {
    const digits = String(part).padStart(2, '0');
    return isPersian ? digits.replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]!) : digits;
  };

  const update = (day: Date, nextHour: number, nextMinute: number) => {
    const next = datePickerAtTime(day, nextHour, nextMinute, timezone);
    setInvalidTime(!next);
    if (next) onChange(next);
  };

  return (
    <fieldset className="space-y-3 rounded-lg border p-4" disabled={disabled}>
      {label && <legend className="px-1 text-sm font-medium">{label}</legend>}
      <DatePicker
        {...datePickerProps}
        {...(id ? { id: `${id}-date` } : {})}
        {...(label ? { label: `${label} ${isPersian ? 'تاریخ' : 'date'}` } : {})}
        locale={locale}
        timezone={timezone}
        disabled={disabled}
        value={value}
        onChange={(day) => {
          setInvalidTime(false);
          if (day) update(day, hour, minute);
          else onChange(undefined);
        }}
      />
      <div
        className="flex flex-wrap items-center gap-2"
        dir="ltr"
        role="group"
        aria-label={timeLabel}
      >
        <select
          className={selectClass}
          aria-label={hourLabel}
          value={displayedHour}
          disabled={!value || disabled}
          onChange={(event) => {
            if (!value) return;
            const selected = Number(event.target.value);
            update(
              value,
              isPersian ? selected : (selected % 12) + (period === 'PM' ? 12 : 0),
              minute
            );
          }}
        >
          {Array.from({ length: isPersian ? 24 : 12 }, (_, index) => {
            const option = isPersian ? index : index + 1;
            return (
              <option key={option} value={option}>
                {clockNumber(option)}
              </option>
            );
          })}
        </select>
        <span aria-hidden="true">:</span>
        <select
          className={selectClass}
          aria-label={minuteLabel}
          value={minute}
          disabled={!value || disabled}
          onChange={(event) => value && update(value, hour, Number(event.target.value))}
        >
          {Array.from({ length: 60 }, (_, option) => (
            <option key={option} value={option}>
              {clockNumber(option)}
            </option>
          ))}
        </select>
        {!isPersian && (
          <select
            className={selectClass}
            aria-label="AM or PM"
            value={period}
            disabled={!value || disabled}
            onChange={(event) =>
              value && update(value, (hour % 12) + (event.target.value === 'PM' ? 12 : 0), minute)
            }
          >
            <option value="AM">AM</option>
            <option value="PM">PM</option>
          </select>
        )}
      </div>
      {invalidTime && (
        <p role="alert" className="text-sm text-destructive">
          {isPersian
            ? 'این زمان در تاریخ انتخاب‌شده معتبر نیست.'
            : 'This time does not exist on the selected date.'}
        </p>
      )}
    </fieldset>
  );
}

export { DateTimePicker };
