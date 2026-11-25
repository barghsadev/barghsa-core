import { useEffect, useId, useRef, useState, type AriaAttributes } from 'react';
import { Button, DatePicker, Input, datePickerCalendarDate } from '@barghsa/ui';
import { accountTimeInputText } from '@barghsa/i18n/account-time-input';
import { formatInTimezone } from '@barghsa/i18n/date-time';
import { isoToDatetimeLocal } from '../lib/due-at-override.js';
import { normalizeProfileDigits } from '../lib/profile-digits.js';

type FieldFeedback = Pick<AriaAttributes, 'aria-invalid' | 'aria-describedby' | 'aria-required'>;

export function RecordDateTimeField({
  id: suppliedId,
  name,
  label,
  locale,
  timezone,
  value,
  onChange,
  onBlur,
  ref,
  disabled,
  clearable,
  ...feedback
}: FieldFeedback & {
  id?: string;
  name: string;
  label: string;
  locale: 'fa' | 'en';
  timezone: string | null;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  ref: (element: HTMLElement | null) => void;
  disabled: boolean;
  clearable?: boolean;
}) {
  const generated = useId();
  const id = suppliedId ?? generated;
  const entryId = `date-time-entry-${id}`;
  const [manual, setManual] = useState(false);
  const focusChangedControl = useRef(false);
  const [day = '', clock = ''] = value.split('T', 2);
  const date = timezone ? datePickerCalendarDate(day, timezone) : undefined;
  const unavailable = disabled || !timezone;
  const word = (key: Parameters<typeof accountTimeInputText>[0]) =>
    accountTimeInputText(key, locale);

  useEffect(() => {
    if (!focusChangedControl.current) return;
    focusChangedControl.current = false;
    document.getElementById(id)?.focus();
  }, [id, manual]);

  function update(nextDay: string, nextClock: string) {
    onChange(nextDay || nextClock ? `${nextDay}T${nextClock}` : '');
  }

  function editClock(input: string) {
    if (locale !== 'fa') {
      update(day, input);
      return;
    }
    const typed = normalizeProfileDigits(input);
    if (!/^(?:\d{0,4}|\d{1,2}:\d{0,2})$/.test(typed)) return;
    const separated = typed.replace(/^(\d{2})(\d+)$/, '$1:$2');
    update(day, /^\d:\d{2}$/.test(separated) ? `0${separated}` : separated);
  }

  return (
    <div className="min-w-0">
      <div id={entryId}>
        {manual ? (
          <Input
            {...feedback}
            id={id}
            name={name}
            ref={ref}
            type="datetime-local"
            dir="ltr"
            lang="en"
            className="min-h-11 w-full min-w-0 max-w-md"
            value={value}
            onBlur={onBlur}
            disabled={unavailable}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <div className="grid max-w-md grid-cols-[minmax(0,1.65fr)_minmax(6rem,1fr)] gap-2">
            <DatePicker
              id={id}
              label={label}
              locale={locale}
              {...(timezone ? { timezone } : {})}
              disabled={unavailable}
              value={date}
              showYearSelect
              compactLabel
              className="min-h-11 border-border"
              triggerProps={{
                ...feedback,
                ref,
                name,
                'aria-describedby':
                  [feedback['aria-describedby'], date ? `${id}-selected-date` : null]
                    .filter(Boolean)
                    .join(' ') || undefined,
              }}
              onBlur={onBlur}
              onChange={(selection) => {
                if (selection && timezone)
                  update(isoToDatetimeLocal(selection.toISOString(), timezone).slice(0, 10), clock);
              }}
            />
            <Input
              {...feedback}
              id={`${id}-time`}
              aria-label={`${label} · ${word(locale === 'fa' ? 'time24' : 'time')}`}
              type={locale === 'fa' ? 'text' : 'time'}
              dir="ltr"
              inputMode={locale === 'fa' ? 'numeric' : undefined}
              placeholder={locale === 'fa' ? '۰۰:۰۰' : undefined}
              autoComplete="off"
              className="h-full min-h-11 w-full min-w-0"
              disabled={unavailable}
              value={clock}
              onBlur={onBlur}
              onChange={(event) => editClock(event.target.value)}
            />
            {date && timezone && (
              <span className="sr-only" id={`${id}-selected-date`}>
                {formatInTimezone(date, timezone, locale, { dateStyle: 'long' })}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-x-3">
        <Button
          type="button"
          variant="link"
          className="min-h-8 px-0 text-xs"
          aria-controls={entryId}
          aria-label={`${label} · ${word(manual ? 'calendar' : 'manual')}`}
          disabled={unavailable}
          onClick={() => {
            focusChangedControl.current = true;
            setManual(!manual);
          }}
        >
          {word(manual ? 'calendar' : 'manual')}
        </Button>
        {clearable && value && (
          <Button
            type="button"
            variant="ghost"
            className="min-h-8 px-0 text-xs text-muted-foreground"
            aria-label={`${label} · ${word('clear')}`}
            disabled={unavailable}
            onClick={() => {
              onChange('');
              document.getElementById(id)?.focus();
            }}
          >
            {word('clear')}
          </Button>
        )}
      </div>
    </div>
  );
}
