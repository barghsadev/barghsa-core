import { useFilterApply } from './filter-apply-context';
import { useId, useState } from 'react';
import { TZDate } from 'react-day-picker';
import { addDays, addMonths, startOfDay, startOfMonth } from 'date-fns';
import { addMonths as addJalaliMonths, startOfMonth as startOfJalaliMonth } from 'date-fns-jalali';
import { DatePicker, datePickerDayBounds } from '../base-ui/date-picker';
import { Button } from './button';
import { Badge } from './badge';
import { Field, FieldGroup, FieldLabel } from './field';
import { NativeSelect, NativeSelectOption } from './native-select';

export interface DateRangeValue {
  from?: string | undefined;
  to?: string | undefined;
}
export type DateRangePreset = 'today' | 'last7' | 'thisMonth' | 'lastMonth';

/** Presets follow the account zone and the calendar displayed to the user. */
export function dateRangePreset(
  preset: DateRangePreset,
  locale: 'en' | 'fa',
  timezone: string,
  now = new Date()
): DateRangeValue {
  const today = startOfDay(new TZDate(now.getTime(), timezone));
  const monthStart = locale === 'fa' ? startOfJalaliMonth : startOfMonth;
  const shiftMonth = locale === 'fa' ? addJalaliMonths : addMonths;
  const from =
    preset === 'today'
      ? today
      : preset === 'last7'
        ? addDays(today, -6)
        : preset === 'thisMonth'
          ? monthStart(today)
          : monthStart(shiftMonth(today, -1));
  const to =
    preset === 'today' || preset === 'last7'
      ? addDays(today, 1)
      : preset === 'thisMonth'
        ? shiftMonth(monthStart(today), 1)
        : monthStart(today);
  return { from: new Date(from.getTime()).toISOString(), to: new Date(to.getTime()).toISOString() };
}

export function DateRangeFilter({
  value,
  onChange,
  locale,
  timezone,
  disabled = false,
  labels,
}: {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  locale: 'en' | 'fa';
  timezone: string;
  disabled?: boolean;
  labels: Record<
    | 'label'
    | 'preset'
    | 'today'
    | 'last7'
    | 'thisMonth'
    | 'lastMonth'
    | 'custom'
    | 'start'
    | 'end'
    | 'apply'
    | 'clear'
    | 'invalid',
    string
  >;
}) {
  const id = useId();
  const key = `${value.from ?? ''}:${value.to ?? ''}:${timezone}`;
  const initial = () => ({
    key,
    custom: false,
    from: value.from ? new Date(value.from) : undefined,
    to: value.to ? new Date(new Date(value.to).getTime() - 1) : undefined,
  });
  const [draft, setDraft] = useState(initial);
  if (draft.key !== key) setDraft(initial());
  const active = Boolean(value.from || value.to);
  const presets = ['today', 'last7', 'thisMonth', 'lastMonth'] as const;
  const matchingPreset = presets.find((preset) => {
    const range = dateRangePreset(preset, locale, timezone);
    return range.from === value.from && range.to === value.to;
  });
  const start = draft.from
    ? datePickerDayBounds(draft.from, timezone).start.toISOString()
    : undefined;
  const end = draft.to
    ? new Date(datePickerDayBounds(draft.to, timezone).end.getTime() + 1).toISOString()
    : undefined;
  const invalid = Boolean(start && end && start >= end);
  const unchanged =
    draft.from?.toISOString() === value.from &&
    (draft.to ? new Date(draft.to.getTime() + 1).toISOString() : undefined) === value.to;
  const deferred = useFilterApply(() =>
    disabled || unchanged ? () => {} : invalid ? null : () => onChange({ from: start, to: end })
  );
  return (
    <details className="rounded-lg border bg-card p-3">
      <summary className="cursor-pointer text-sm font-medium">
        {labels.label}
        {active && (
          <Badge variant="secondary" className="ms-2">
            {locale === 'fa' ? '۱' : '1'}
          </Badge>
        )}
      </summary>
      <FieldGroup className="mt-3">
        <Field>
          <FieldLabel htmlFor={`${id}-preset`}>{labels.preset}</FieldLabel>
          <NativeSelect
            id={`${id}-preset`}
            disabled={disabled}
            value={draft.custom ? 'custom' : (matchingPreset ?? 'custom')}
            onChange={(event) => {
              const preset = event.target.value;
              if (preset === 'custom') {
                setDraft((current) => ({ ...current, custom: true }));
              } else {
                const range = dateRangePreset(preset as DateRangePreset, locale, timezone);
                setDraft({
                  key: `${range.from ?? ''}:${range.to ?? ''}:${timezone}`,
                  custom: false,
                  from: range.from ? new Date(range.from) : undefined,
                  to: range.to ? new Date(new Date(range.to).getTime() - 1) : undefined,
                });
                onChange(range);
              }
            }}
          >
            <NativeSelectOption value="custom">{labels.custom}</NativeSelectOption>
            {presets.map((preset) => (
              <NativeSelectOption key={preset} value={preset}>
                {labels[preset]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <FieldGroup className="grid gap-3 sm:grid-cols-2">
          <Field data-invalid={invalid}>
            <FieldLabel htmlFor={`${id}-start`}>{labels.start}</FieldLabel>
            <DatePicker
              id={`${id}-start`}
              label={labels.start}
              locale={locale}
              timezone={timezone}
              disabled={disabled}
              value={draft.from}
              onChange={(from) => {
                setDraft((current) => ({ ...current, from, custom: true }));
              }}
            />
          </Field>
          <Field data-invalid={invalid}>
            <FieldLabel htmlFor={`${id}-end`}>{labels.end}</FieldLabel>
            <DatePicker
              id={`${id}-end`}
              label={labels.end}
              locale={locale}
              timezone={timezone}
              disabled={disabled}
              value={draft.to}
              onChange={(to) => {
                setDraft((current) => ({ ...current, to, custom: true }));
              }}
              {...(invalid ? { error: labels.invalid } : {})}
            />
          </Field>
        </FieldGroup>
        <div className="flex flex-wrap gap-3">
          {!deferred && (
            <Button
              type="button"
              variant="outline"
              disabled={disabled || invalid}
              onClick={() => onChange({ from: start, to: end })}
            >
              {labels.apply}
            </Button>
          )}
          {active && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDraft((current) => ({ ...current, custom: false }));
                onChange({});
              }}
            >
              {labels.clear}
            </Button>
          )}
        </div>
      </FieldGroup>
    </details>
  );
}
