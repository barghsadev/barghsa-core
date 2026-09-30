import { useId, useState } from 'react';
import { Button } from './button';
import { Field, FieldLabel } from './field';
import { Input } from './input';

interface RangeValue {
  min?: string | undefined;
  max?: string | undefined;
}

/** Keep draft input local until an exact, domain-validated range is applied. */
export function NumberFilter({
  value,
  onChange,
  parseRange,
  labels,
}: {
  value: RangeValue;
  onChange: (range: RangeValue) => void;
  parseRange: (min: string, max: string) => RangeValue | null;
  labels: Record<'label' | 'min' | 'max' | 'apply' | 'clear' | 'invalid', string>;
}) {
  const id = useId();
  const key = `${value.min ?? ''}:${value.max ?? ''}`;
  const initial = () => ({ key, min: value.min ?? '', max: value.max ?? '' });
  const [draft, setDraft] = useState(initial);
  if (draft.key !== key) setDraft(initial());
  const parsed = parseRange(draft.min, draft.max);
  const changed = draft.min !== (value.min ?? '') || draft.max !== (value.max ?? '');
  return (
    <fieldset className="min-w-0 space-y-3 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">{labels.label}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {(['min', 'max'] as const).map((bound) => (
          <Field key={bound}>
            <FieldLabel htmlFor={`${id}-${bound}`}>{labels[bound]}</FieldLabel>
            <Input
              id={`${id}-${bound}`}
              inputMode="numeric"
              dir="ltr"
              maxLength={32}
              value={draft[bound]}
              aria-invalid={parsed === null}
              aria-describedby={parsed === null ? `${id}-error` : undefined}
              onChange={(event) => setDraft({ ...draft, [bound]: event.target.value })}
            />
          </Field>
        ))}
      </div>
      {parsed === null && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {labels.invalid}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!parsed || !changed}
          onClick={() => {
            if (parsed) onChange(parsed);
          }}
        >
          {labels.apply}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={!draft.min && !draft.max && !value.min && !value.max}
          onClick={() => {
            setDraft({ key, min: '', max: '' });
            onChange({});
          }}
        >
          {labels.clear}
        </Button>
      </div>
    </fieldset>
  );
}
