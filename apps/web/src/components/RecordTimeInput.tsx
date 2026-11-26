import type { ComponentProps } from 'react';
import { Input } from '@barghsa/ui';
import { normalizeProfileDigits } from '../lib/profile-digits.js';

type RecordTimeInputProps = Omit<ComponentProps<typeof Input>, 'type' | 'value' | 'onChange'> & {
  locale: 'en' | 'fa';
  value: string;
  onChange: (value: string) => void;
};

export function RecordTimeInput({ locale, value, onChange, ...inputProps }: RecordTimeInputProps) {
  const localEntry = locale === 'fa';
  return (
    <Input
      type={localEntry ? 'text' : 'time'}
      inputMode={localEntry ? 'numeric' : undefined}
      placeholder={localEntry ? '۰۰:۰۰' : undefined}
      autoComplete="off"
      dir="ltr"
      {...inputProps}
      value={value}
      onChange={(event) => {
        const raw = event.target.value;
        if (!localEntry) {
          onChange(raw);
          return;
        }
        const typed = normalizeProfileDigits(raw).trim();
        if (!/^(?:\d{0,4}|\d{1,2}:\d{0,2})$/.test(typed)) return;
        const separated = typed.replace(/^(\d{2})(\d+)$/, '$1:$2');
        onChange(/^\d:\d{2}$/.test(separated) ? `0${separated}` : separated);
      }}
    />
  );
}
