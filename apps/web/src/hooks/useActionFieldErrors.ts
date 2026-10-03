import { useEffect, useRef } from 'react';
import {
  setServerFieldErrors,
  type FieldPath,
  type FieldValues,
  type UseFormReturn,
} from '@barghsa/ui/form';

/** Only public field identifiers are accepted; messages always come from the owning form. */
export function useActionFieldErrors<Values extends FieldValues>(
  form: UseFormReturn<Values>,
  messages: Partial<Record<FieldPath<Values>, string>>,
  fallback: string
) {
  const pendingFocus = useRef<FieldPath<Values> | null>(null);
  const errors = form.formState.errors;
  useEffect(() => {
    const field = pendingFocus.current;
    if (!field) return;
    // The confirmation dialog must close and the editor must unlock before focusing.
    const frame = requestAnimationFrame(() => {
      pendingFocus.current = null;
      form.setFocus(field);
    });
    return () => cancelAnimationFrame(frame);
  }, [errors, form]);
  return (names: unknown[]): boolean => {
    const fields = Object.keys(messages) as FieldPath<Values>[];
    if (!names.length || !names.every((name) => fields.some((field) => field === name)))
      return false;
    setServerFieldErrors(
      {
        setError: form.setError,
        setFocus: (field) => {
          pendingFocus.current = field;
        },
      },
      Object.fromEntries(
        names.map((name) => [name, messages[name as FieldPath<Values>] ?? fallback])
      ),
      fields,
      fallback
    );
    return true;
  };
}
