import { useEffect, useRef, useState, type AriaAttributes, type RefCallback } from 'react';
import { Button, DatePicker, Input, datePickerCalendarDate } from '@barghsa/ui';
import { settingsDateEntryText } from '@barghsa/i18n/settings-forms';

export function CompanyRegistrationDateField({
  id,
  name,
  label,
  locale,
  timezone = 'UTC',
  numerals,
  value,
  disabled,
  inputRef,
  onBlur,
  onChange,
  ...feedback
}: Pick<AriaAttributes, 'aria-invalid' | 'aria-describedby'> & {
  id: string;
  name: string;
  label: string;
  locale: 'fa' | 'en';
  timezone?: string;
  numerals?: 'arabext' | 'latn';
  value: string;
  disabled: boolean;
  inputRef: RefCallback<HTMLElement>;
  onBlur: () => void;
  onChange: (value: string) => void;
}) {
  const [manual, setManual] = useState(false);
  const focusDate = useRef(false);
  const copy = settingsDateEntryText[locale];
  const modeAction = manual ? copy.calendar : copy.manual;
  useEffect(() => {
    if (!focusDate.current) return;
    focusDate.current = false;
    document.getElementById(id)?.focus();
  }, [id, manual]);

  return (
    <>
      {manual ? (
        <Input
          {...feedback}
          id={id}
          name={name}
          ref={inputRef}
          type="date"
          dir="ltr"
          lang="en"
          value={value}
          disabled={disabled}
          onBlur={onBlur}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <DatePicker
          id={id}
          label={label}
          locale={locale}
          timezone={timezone}
          {...(numerals ? { numerals } : {})}
          compactLabel
          showYearSelect
          disabled={disabled}
          className="min-h-11"
          value={datePickerCalendarDate(value, timezone)}
          triggerProps={{ ...feedback, name, ref: inputRef }}
          onBlur={onBlur}
          onChange={(date) =>
            onChange(
              date
                ? `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
                : ''
            )
          }
        />
      )}
      <div className="flex flex-wrap gap-x-3">
        <Button
          type="button"
          variant="link"
          size="sm"
          className="px-0"
          disabled={disabled}
          aria-label={`${label} · ${modeAction}`}
          onClick={() => {
            focusDate.current = true;
            setManual(!manual);
          }}
        >
          {modeAction}
        </Button>
        {value && (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="px-0"
            disabled={disabled}
            aria-label={`${label} · ${copy.clear}`}
            onClick={() => {
              onChange('');
              document.getElementById(id)?.focus();
            }}
          >
            {copy.clear}
          </Button>
        )}
      </div>
    </>
  );
}
