import type { FieldPath, FieldValues, UseFormReturn } from 'react-hook-form';

/** Callers supply localized messages and a whitelist of fields owned by their form. */
export function setServerFieldErrors<Values extends FieldValues>(
  form: Pick<UseFormReturn<Values>, 'setError' | 'setFocus'>,
  fieldErrors: unknown,
  fields: readonly FieldPath<Values>[],
  fallbackMessage: string
): void {
  const errors =
    fieldErrors && typeof fieldErrors === 'object' && !Array.isArray(fieldErrors)
      ? Object.entries(fieldErrors)
      : [];
  const safe = new Map<FieldPath<Values>, string>();
  let unmapped = errors.length === 0;
  for (const [name, value] of errors) {
    const field = fields.find((candidate) => candidate === name);
    const message = Array.isArray(value) ? value[0] : value;
    if (
      !field ||
      name.split('.').some((part) => ['__proto__', 'prototype', 'constructor'].includes(part)) ||
      typeof message !== 'string' ||
      !message.trim() ||
      message.length > 500
    ) {
      unmapped = true;
      continue;
    }
    safe.set(field, message);
  }
  for (const [field, message] of safe) form.setError(field, { type: 'server', message });
  if (unmapped) form.setError('root.server', { type: 'server', message: fallbackMessage });
  const first = fields.find((field) => safe.has(field));
  if (first) form.setFocus(first);
}
