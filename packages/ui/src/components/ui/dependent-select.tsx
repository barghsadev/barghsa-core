import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

export interface DependentSelectOption {
  value: string;
  label: string;
  dependencyValue: string;
}

type DependentSelectProps = Omit<
  ComponentProps<'select'>,
  'children' | 'value' | 'defaultValue'
> & {
  dependencyValue: string;
  value: string;
  options: readonly DependentSelectOption[];
  placeholder: string;
  ready?: boolean;
  loading?: boolean;
  /** Display an existing saved value without making it selectable for a new address. */
  savedOption?: DependentSelectOption;
};

/**
 * Filters synchronous options by the controlling field. For async options, bind
 * ready/loading to the request for that dependency; the caller owns fetching,
 * cancellation, retry and clearing the child value when the parent changes.
 */
export function DependentSelect({
  dependencyValue,
  value,
  options,
  placeholder,
  ready = true,
  loading = false,
  savedOption,
  disabled,
  className,
  onChange,
  ...props
}: DependentSelectProps) {
  const available = ready && !loading && !!dependencyValue;
  const choices = available
    ? options.filter((option) => option.dependencyValue === dependencyValue)
    : [];
  const saved =
    dependencyValue &&
    savedOption?.value &&
    savedOption.dependencyValue === dependencyValue &&
    savedOption.value === value
      ? savedOption
      : undefined;
  const known = choices.some((option) => option.value === value);
  return (
    <select
      {...props}
      data-slot="dependent-select"
      value={known || saved ? value : ''}
      disabled={disabled || !available}
      aria-busy={loading || undefined}
      className={cn(
        'h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive',
        className
      )}
      onChange={(event) => {
        if (
          disabled ||
          !available ||
          (event.target.value && !choices.some((option) => option.value === event.target.value))
        )
          return;
        onChange?.(event);
      }}
    >
      <option value="">{placeholder}</option>
      {saved && !known && (
        <option value={saved.value} disabled>
          {saved.label}
        </option>
      )}
      {choices.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
