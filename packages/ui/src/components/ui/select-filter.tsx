import { useId, useState } from 'react';
import { ComboBox, ComboBoxInput, ComboBoxItem, ComboBoxPopup } from '../base-ui/combo-box';
import { Field, FieldLabel } from './field';

export function SelectFilter({
  value,
  onChange,
  options,
  label,
  allLabel,
  emptyLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  label: string;
  allLabel: string;
  emptyLabel: string;
}) {
  const id = useId();
  const items = [{ value: '', label: allLabel }, ...options];
  const selected = items.find((item) => item.value === value) ?? null;
  const labelText = selected?.label ?? '';
  const [input, setInput] = useState({ value, label: labelText, text: labelText });
  if (input.value !== value || input.label !== labelText)
    setInput({ value, label: labelText, text: labelText });
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <ComboBox
        items={items}
        value={selected}
        inputValue={input.text}
        filteredItems={input.text === labelText ? items : undefined}
        onInputValueChange={(text) => setInput({ value, label: labelText, text })}
        itemToStringLabel={(item) => item.label}
        isItemEqualToValue={(item, selected) => item.value === selected.value}
        onValueChange={(item) => onChange(item?.value ?? '')}
      >
        <ComboBoxInput id={id} />
        <ComboBoxPopup emptyMessage={emptyLabel}>
          {(item: { value: string; label: string }) => (
            <ComboBoxItem key={item.value} value={item}>
              {item.label}
            </ComboBoxItem>
          )}
        </ComboBoxPopup>
      </ComboBox>
    </Field>
  );
}
