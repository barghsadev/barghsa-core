import { useId } from 'react';
import { Field, FieldLabel } from './field';
import { NativeSelect, NativeSelectOption } from './native-select';

export function ListSortDropdown({
  value,
  onChange,
  label,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  options: readonly { value: string; label: string }[];
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id} data-slot="list-sort-label">
        {label}
      </FieldLabel>
      <NativeSelect
        className="max-w-full"
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  );
}
