import { useEffect, useId, useRef, useState } from 'react';
import { Field, FieldLabel } from './field';
import { ListSearchInput } from './list-toolbar';
import { useFilterApply } from './filter-apply-context';

export function TextFilter({
  value,
  onChange,
  label,
  placeholder,
  maxLength = 120,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  maxLength?: number;
}) {
  const id = useId();
  const [draft, setDraft] = useState({ external: value, text: value });
  if (draft.external !== value) setDraft({ external: value, text: value });
  const change = useRef(onChange);
  const deferred = useFilterApply(() => () => onChange(draft.text.trim()));
  useEffect(() => {
    change.current = onChange;
  }, [onChange]);
  useEffect(() => {
    if (deferred || draft.external !== value || draft.text.trim() === value) return;
    const timer = setTimeout(() => change.current(draft.text.trim()), 300);
    return () => clearTimeout(timer);
  }, [draft, value, deferred]);
  return (
    <Field>
      <FieldLabel htmlFor={id} data-slot="list-search-label">
        {label}
      </FieldLabel>
      <ListSearchInput
        id={id}
        label={label}
        value={draft.text}
        placeholder={placeholder ?? label}
        maxLength={maxLength}
        onChange={(event) => setDraft({ external: value, text: event.target.value })}
      />
    </Field>
  );
}
