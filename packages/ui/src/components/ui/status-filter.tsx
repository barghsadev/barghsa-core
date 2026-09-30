import { StatusBadge, type StatusTone } from './workflow';

export function StatusFilter({
  options,
  value,
  onChange,
  label,
  clearLabel,
  countLabel,
}: {
  options: { value: string; label: string; tone: StatusTone }[];
  value: readonly string[];
  onChange: (value: string[]) => void;
  label: string;
  clearLabel: string;
  countLabel: string;
}) {
  return (
    <details className="rounded-lg border bg-card p-3">
      <summary className="cursor-pointer text-sm font-medium">
        {label}
        {value.length > 0 && (
          <span className="ms-2 rounded-full bg-primary/10 px-2 py-0.5 text-primary">
            {countLabel}
          </span>
        )}
      </summary>
      <fieldset className="mt-3 flex flex-wrap gap-3">
        <legend className="sr-only">{label}</legend>
        {options.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-center gap-2 rounded-md p-1"
          >
            <input
              type="checkbox"
              checked={value.includes(option.value)}
              onChange={(event) =>
                onChange(
                  options
                    .filter((entry) =>
                      entry.value === option.value
                        ? event.target.checked
                        : value.includes(entry.value)
                    )
                    .map((entry) => entry.value)
                )
              }
            />
            <StatusBadge label={option.label} tone={option.tone} />
          </label>
        ))}
      </fieldset>
      {value.length > 0 && (
        <button
          type="button"
          className="mt-3 text-sm text-primary underline"
          onClick={() => onChange([])}
        >
          {clearLabel}
        </button>
      )}
    </details>
  );
}
