import { useLayoutEffect, useRef } from 'react';
import {
  setServerFieldErrors,
  type FieldErrors,
  type FieldPath,
  type FieldValues,
  type UseFormReturn,
} from '@barghsa/ui/form';
export function useSettingsFormFeedback<Values extends FieldValues>(
  form: UseFormReturn<Values>,
  scope: string,
  locked: boolean,
  coordination: { isLocked: () => boolean; isCurrent: () => boolean },
  messages: Partial<Record<FieldPath<Values>, string>>,
  fallback: string,
  enabled = true
) {
  const element = useRef<HTMLFormElement>(null),
    pending = useRef<{ field: FieldPath<Values>; scope: string } | null>(null);
  const { errors, isSubmitting } = form.formState;
  const focus = (field: FieldPath<Values>) => {
    pending.current = { field, scope };
  };
  useLayoutEffect(() => {
    const request = pending.current;
    if (!request) return;
    if (request.scope !== scope || !enabled || !coordination.isCurrent()) {
      pending.current = null;
      return;
    }
    if (locked || isSubmitting || coordination.isLocked()) return;
    const field = element.current?.elements.namedItem(request.field);
    if (!(field instanceof HTMLElement) || field.matches(':disabled')) return;
    pending.current = null;
    field.focus();
  }, [errors, isSubmitting, scope, locked, coordination, enabled]);
  function invalid(fields: FieldErrors<Values>) {
    const values = form.getValues();
    const first = Object.keys(fields).find((name) => Object.hasOwn(values, name));
    if (first) focus(first as FieldPath<Values>);
  }
  function fields(names: unknown[]): boolean {
    const owned = Object.keys(messages) as FieldPath<Values>[];
    if (!names.length || !names.every((name) => owned.some((field) => field === name)))
      return false;
    setServerFieldErrors(
      { setError: form.setError, setFocus: focus },
      Object.fromEntries(
        names.map((name) => [name, messages[name as FieldPath<Values>] ?? fallback])
      ),
      owned,
      fallback
    );
    return true;
  }
  return { element, invalid, fields };
}
