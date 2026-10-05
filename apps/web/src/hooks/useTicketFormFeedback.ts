import { useLayoutEffect, useRef } from 'react';
import {
  setServerFieldErrors,
  type FieldErrors,
  type FieldPath,
  type FieldValues,
  type UseFormReturn,
} from '@barghsa/ui/form';
import type { TicketCoordination } from '../lib/ticket-form.js';

/** Ticket fields remain disabled until the page owner has released its command. */
export function useTicketFormFeedback<Values extends FieldValues>(
  form: UseFormReturn<Values>,
  scope: string,
  locked: boolean,
  coordination: TicketCoordination | undefined,
  messages: Partial<Record<FieldPath<Values>, string>>,
  fallback: string,
  enabled = true
) {
  const element = useRef<HTMLFormElement>(null);
  const pending = useRef<{ field: FieldPath<Values>; scope: string } | null>(null);
  const { errors, isSubmitting } = form.formState;
  const requestFocus = (field: FieldPath<Values>) => {
    pending.current = { field, scope };
  };
  useLayoutEffect(() => {
    const request = pending.current;
    if (!request) return;
    if (request.scope !== scope || !enabled || (coordination && !coordination.isCurrent())) {
      pending.current = null;
      return;
    }
    if (locked || isSubmitting || coordination?.isLocked()) return;
    const field = element.current?.elements.namedItem(request.field);
    if (!(field instanceof HTMLElement) || field.matches(':disabled')) return;
    pending.current = null;
    field.focus();
  }, [errors, isSubmitting, scope, locked, coordination, enabled]);
  const invalid = (invalidFields: FieldErrors<Values>) => {
    const values = form.getValues();
    const first = Object.keys(invalidFields).find((name) =>
      Object.prototype.hasOwnProperty.call(values, name)
    );
    if (first) requestFocus(first as FieldPath<Values>);
  };
  const fields = (names: unknown[]): boolean => {
    const owned = Object.keys(messages) as FieldPath<Values>[];
    if (!names.length || !names.every((name) => owned.some((field) => field === name)))
      return false;
    setServerFieldErrors(
      { setError: form.setError, setFocus: requestFocus },
      Object.fromEntries(
        names.map((name) => [name, messages[name as FieldPath<Values>] ?? fallback])
      ),
      owned,
      fallback
    );
    return true;
  };
  return { element, invalid, fields };
}
