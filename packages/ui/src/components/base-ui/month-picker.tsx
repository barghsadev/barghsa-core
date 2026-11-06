import type { ComponentProps } from 'react';
import { NativeSelect, NativeSelectOption } from '../ui/native-select';

type MonthPickerProps = Omit<
  ComponentProps<typeof NativeSelect>,
  'children' | 'multiple' | 'value' | 'defaultValue'
> & {
  /** Owners supply permitted months and localized labels from accepted server periods. */
  months: readonly { value: string; label: string; disabled?: boolean }[];
  value?: string;
  defaultValue?: string;
};

function MonthPicker({ months, ...props }: MonthPickerProps) {
  return (
    <NativeSelect {...props} multiple={false}>
      {months.map(({ value, label, disabled }) => (
        <NativeSelectOption key={value} value={value} disabled={disabled}>
          {label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

export { MonthPicker };
export type { MonthPickerProps };
