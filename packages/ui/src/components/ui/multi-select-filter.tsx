import { useId, useRef, useState } from 'react';
import {
  ComboBox,
  ComboBoxInput,
  ComboBoxItem,
  ComboBoxPopup,
  ComboBoxChips,
  ComboBoxChip,
} from '../base-ui/combo-box';
import { Field, FieldLabel } from './field';
import { Button } from './button';

/** Controlled selections; searching never changes the applied filter. */
export function MultiSelectFilter({
  value,
  onChange,
  options,
  label,
  emptyLabel,
  clearLabel,
  removeLabel,
}: {
  value: readonly string[];
  onChange: (value: string[]) => void;
  options: readonly { value: string; label: string }[];
  label: string;
  emptyLabel: string;
  clearLabel: string;
  removeLabel: (label: string) => string;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const selectionKey = value.join(',');
  const [search, setSearch] = useState({ selectionKey, text: '' });
  if (search.selectionKey !== selectionKey) setSearch({ selectionKey, text: '' });
  const setInput = (text: string) => setSearch({ selectionKey, text });
  const selected = options.filter((item) => value.includes(item.value));
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <ComboBox
        multiple
        items={[...options]}
        value={selected}
        inputValue={search.selectionKey === selectionKey ? search.text : ''}
        onInputValueChange={setInput}
        onOpenChange={(_open, details) => {
          // Keep the choices available while customers add multiple statuses.
          if (details.reason === 'item-press') details.cancel();
        }}
        itemToStringLabel={(item) => item.label}
        isItemEqualToValue={(item, selection) => item.value === selection.value}
        onValueChange={(items) => {
          onChange(items.map((item) => item.value));
          setInput('');
        }}
      >
        <ComboBoxChips className="mt-2">
          {selected.map((item) => (
            <ComboBoxChip
              key={item.value}
              removeLabel={removeLabel(item.label)}
              className="[&_button]:min-h-11 [&_button]:min-w-11"
            >
              {item.label}
            </ComboBoxChip>
          ))}
          <ComboBoxInput ref={inputRef} id={id} className="min-h-11" />
        </ComboBoxChips>
        <ComboBoxPopup emptyMessage={emptyLabel}>
          {(item: { value: string; label: string }) => (
            <ComboBoxItem key={item.value} value={item} className="min-h-11">
              {item.label}
            </ComboBoxItem>
          )}
        </ComboBoxPopup>
      </ComboBox>
      {selected.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 w-fit"
          onClick={() => {
            onChange([]);
            setInput('');
            inputRef.current?.focus();
          }}
        >
          {clearLabel}
        </Button>
      )}
    </Field>
  );
}
