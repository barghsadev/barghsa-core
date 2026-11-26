import type { ComponentProps } from 'react';
import { Input } from '@barghsa/ui';
import { normalizeProfileDigits } from '../lib/profile-digits.js';

type RecordNumberInputProps = Omit<ComponentProps<typeof Input>, 'type' | 'value' | 'onChange'> & {
  locale: 'en' | 'fa';
  value: string;
  onChange: (value: string) => void;
};

export function RecordNumberInput({
  locale,
  min,
  max,
  step,
  value,
  onChange,
  ...inputProps
}: RecordNumberInputProps) {
  const localized = locale === 'fa';
  const decimal = step !== undefined && Number(step) !== 1;
  return (
    <Input
      {...inputProps}
      type={localized ? 'text' : 'number'}
      inputMode={localized ? (decimal ? 'decimal' : 'numeric') : undefined}
      dir="ltr"
      min={localized ? undefined : min}
      max={localized ? undefined : max}
      step={localized ? undefined : step}
      value={value}
      onChange={(event) => {
        const input = event.currentTarget;
        const raw = input.value;
        const normalized = localized ? normalizeProfileDigits(raw).replaceAll('٫', '.') : raw;
        if (normalized !== raw) {
          const { selectionStart, selectionEnd } = input;
          input.value = normalized;
          input.setSelectionRange(selectionStart, selectionEnd);
        }
        onChange(normalized);
      }}
    />
  );
}
