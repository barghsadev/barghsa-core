import type { AriaAttributes, ComponentProps } from 'react';
import type { FieldPathByValue, FieldValues } from 'react-hook-form';
import type { DateRange } from 'react-day-picker';
import { DatePicker } from '../components/base-ui/date-picker';
import { BoundField, type BoundFieldProps } from './bound-field';
import { FormControl } from './form';

type PickerProps = Pick<
  ComponentProps<typeof DatePicker>,
  | 'locale'
  | 'jalali'
  | 'timezone'
  | 'numerals'
  | 'minDate'
  | 'maxDate'
  | 'placeholder'
  | 'className'
>;
type DateName<Values extends FieldValues> = FieldPathByValue<Values, Date | null | undefined>;
type RangeName<Values extends FieldValues> = FieldPathByValue<Values, DateRange | null | undefined>;
export type FormDatePickerProps<
  Values extends FieldValues,
  Name extends DateName<Values> = DateName<Values>,
  Output = Values,
> = BoundFieldProps<Values, Name, Output> & { inputProps?: PickerProps };
export type FormDateRangePickerProps<
  Values extends FieldValues,
  Name extends RangeName<Values> = RangeName<Values>,
  Output = Values,
> = BoundFieldProps<Values, Name, Output> & { inputProps?: PickerProps };

// FormControl's attributes must reach the trigger rather than the popover root.
function DateControl({
  id,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  ...props
}: ComponentProps<typeof DatePicker> & Pick<AriaAttributes, 'aria-describedby' | 'aria-invalid'>) {
  return (
    <DatePicker
      {...props}
      {...(id !== undefined ? { id } : {})}
      triggerProps={{
        ...props.triggerProps,
        'aria-describedby': describedBy,
        'aria-invalid': invalid,
      }}
    />
  );
}
export function FormDatePicker<
  Values extends FieldValues,
  Name extends DateName<Values>,
  Output = Values,
>({ inputProps, ...props }: FormDatePickerProps<Values, Name, Output>) {
  return (
    <BoundField
      {...props}
      renderControl={({ field, disabled, labelId }) => (
        <FormControl>
          <DateControl
            {...inputProps}
            calendarMode="single"
            value={field.value ?? undefined}
            onChange={(value) => field.onChange(value ?? null)}
            onBlur={field.onBlur}
            disabled={disabled}
            triggerProps={{ ref: field.ref, name: field.name, 'aria-labelledby': labelId }}
          />
        </FormControl>
      )}
    />
  );
}
/** Uses the existing timezone-aware half-open range: `to` is the first excluded day. */
export function FormDateRangePicker<
  Values extends FieldValues,
  Name extends RangeName<Values>,
  Output = Values,
>({ inputProps, ...props }: FormDateRangePickerProps<Values, Name, Output>) {
  return (
    <BoundField
      {...props}
      renderControl={({ field, disabled, labelId }) => (
        <FormControl>
          <DateControl
            {...inputProps}
            calendarMode="range"
            value={field.value ?? undefined}
            onChange={(value) => field.onChange(value ?? null)}
            onBlur={field.onBlur}
            disabled={disabled}
            triggerProps={{ ref: field.ref, name: field.name, 'aria-labelledby': labelId }}
          />
        </FormControl>
      )}
    />
  );
}
