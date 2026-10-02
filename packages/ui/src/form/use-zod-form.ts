import { useCallback, useEffect, useRef, type BaseSyntheticEvent } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  useForm,
  type FieldValues,
  type FieldPath,
  type UseFormHandleSubmit,
  type UseFormProps,
  type UseFormReturn,
  type UseFormSetFocus,
  type SubmitHandler,
  type SubmitErrorHandler,
} from 'react-hook-form';
import type { ZodType } from 'zod';

function firstErrorField(errors: unknown, prefix = ''): string | undefined {
  if (!errors || typeof errors !== 'object') return;
  if ('type' in errors && typeof errors.type === 'string') {
    return prefix || undefined;
  }
  for (const [name, value] of Object.entries(errors)) {
    if (name === 'root') continue;
    const field = firstErrorField(value, prefix ? `${prefix}.${name}` : name);
    if (field) return field;
  }
  return undefined;
}

export function useZodForm<Input extends FieldValues, Output extends FieldValues = Input>(
  schema: ZodType<Output, Input>,
  options: Omit<UseFormProps<Input, unknown, Output>, 'resolver' | 'mode' | 'shouldFocusError'> = {}
): UseFormReturn<Input, unknown, Output> & { isSubmissionPending: () => boolean } {
  const form = useForm<Input, unknown, Output>({
    ...options,
    resolver: zodResolver(schema),
    mode: 'onTouched',
    // Native focus happens before isSubmitting clears and cannot focus disabled controls.
    shouldFocusError: false,
  });
  const pending = useRef(false);
  const pendingFocus = useRef<(() => void) | null>(null);
  const nativeSetFocus = form.setFocus;
  const isSubmitting = form.formState.isSubmitting;
  const errors = form.formState.errors;
  const setFocus: UseFormSetFocus<Input> = useCallback(
    (name, options) => {
      if (pending.current) pendingFocus.current = () => nativeSetFocus(name, options);
      else nativeSetFocus(name, options);
    },
    [nativeSetFocus]
  );
  useEffect(() => {
    // Validation runs while fields are disabled. Focus after their next DOM commit.
    if (!isSubmitting && pendingFocus.current) {
      const focus = pendingFocus.current;
      pendingFocus.current = null;
      focus();
    }
  }, [isSubmitting, errors, nativeSetFocus]);
  const nativeHandleSubmit = form.handleSubmit;
  const handleSubmit: UseFormHandleSubmit<Input, Output> = useCallback(
    <Result>(onValid: SubmitHandler<Output, Result>, onInvalid?: SubmitErrorHandler<Input>) =>
      async (event?: BaseSyntheticEvent): Promise<Awaited<Result> | undefined> => {
        if (pending.current) {
          event?.preventDefault();
          return;
        }
        // Lock before the asynchronous resolver can yield, including programmatic submits.
        pending.current = true;
        try {
          return await nativeHandleSubmit<Result>(onValid, async (errors, invalidEvent) => {
            const field = firstErrorField(errors);
            // Resolver error paths describe schema input fields; look up the current registered ref.
            pendingFocus.current = field ? () => nativeSetFocus(field as FieldPath<Input>) : null;
            await onInvalid?.(errors, invalidEvent);
          })(event);
        } finally {
          pending.current = false;
        }
      },
    [nativeHandleSubmit, nativeSetFocus]
  );
  const isSubmissionPending = useCallback(() => pending.current, []);
  return { ...form, handleSubmit, setFocus, isSubmissionPending };
}
