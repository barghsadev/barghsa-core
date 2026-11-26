import { useImperativeHandle, useRef, useState, type RefObject } from 'react';
import { DatePicker, FieldLabel } from '@barghsa/ui';
import type { Locale } from '@barghsa/i18n/app';
import { documentText } from '@barghsa/i18n/documents';
import { datetimeLocalToIso } from '@barghsa/i18n/account-time-input';
import { RecordTimeInput } from './RecordTimeInput.js';

export type HoldExpiryFields = { read: () => string | null; focus: () => void };

export default function LegalHoldExpiryDatePicker({
  locale,
  timezone,
  invalid,
  editorRef,
  onEdit,
}: {
  locale: Locale;
  timezone: string | null;
  invalid: boolean;
  editorRef: RefObject<HoldExpiryFields | null>;
  onEdit: () => void;
}) {
  const [date, setDate] = useState<Date>();
  const [time, setTime] = useState('');
  const dateRef = useRef<HTMLButtonElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(editorRef, () => ({
    read: () => {
      if (!date || !time || !timezone) return null;
      const day = new Intl.DateTimeFormat('sv-SE', {
        timeZone: timezone,
        calendar: 'gregory',
      }).format(date);
      return datetimeLocalToIso(`${day}T${time}`, timezone);
    },
    focus: () => (date ? timeRef : dateRef).current?.focus(),
  }));
  const dateLabel = documentText('holdExpiryDate', locale);
  const feedback = {
    'aria-required': true,
    'aria-invalid': invalid || undefined,
    'aria-describedby': invalid ? 'hold-expiry-error' : 'hold-expiry-help',
  };
  return (
    <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-1">
        <FieldLabel htmlFor="hold-expiry-date">{dateLabel}</FieldLabel>
        <DatePicker
          id="hold-expiry-date"
          label={dateLabel}
          locale={locale}
          disabled={!timezone}
          {...(timezone ? { timezone } : {})}
          value={date}
          minDate={new Date()}
          className="min-h-11"
          triggerProps={{ ref: dateRef, ...feedback }}
          onChange={(value) => {
            setDate(value);
            onEdit();
          }}
        />
      </div>
      <div className="min-w-0 space-y-1">
        <FieldLabel htmlFor="hold-expiry-time">{documentText('holdExpiryTime', locale)}</FieldLabel>
        <RecordTimeInput
          id="hold-expiry-time"
          ref={timeRef}
          locale={locale}
          className="w-full min-w-0"
          disabled={!timezone}
          value={time}
          onChange={(value) => {
            setTime(value);
            onEdit();
          }}
          {...feedback}
        />
      </div>
    </div>
  );
}
