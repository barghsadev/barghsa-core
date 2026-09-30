import { useEffect, useId, useRef, useState } from 'react';
import { Field, FieldLabel } from './field';
import { Input } from './input';
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
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="search"
        value={draft.text}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(event) => setDraft({ external: value, text: event.target.value })}
      />
    </Field>
  );
}
