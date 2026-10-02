import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { useZodForm, useWatch } from '@barghsa/ui/form';
import { z } from 'zod';

/** Existing localized field rules remain authoritative; RHF owns the partial draft and feedback. */
export function useOnboardingForm(
  defaults: Record<string, string>,
  validate: (field: string, value: string) => string | undefined
) {
  const schema = z.object(
    Object.fromEntries(
      Object.keys(defaults).map((name) => [
        name,
        z.string().superRefine((value, context) => {
          const message = validate(name, value);
          if (message) context.addIssue({ code: 'custom', message });
        }),
      ])
    )
  );
  const form = useZodForm(schema, { defaultValues: defaults });
  const watched = useWatch({ control: form.control });
  const values: Record<string, string> = Object.fromEntries(
    Object.entries(defaults).map(([name, value]) => [name, watched[name] ?? value])
  );
  const names = Object.keys(defaults).join('\0');
  useEffect(() => {
    // All stages remain registered, including fields outside the currently visible step.
    for (const name of names.split('\0')) form.register(name);
  }, [names, form.register]);
  const errors = Object.fromEntries(
    Object.entries(form.formState.errors).map(([name, error]) => [name, error?.message])
  );
  const touched = Object.fromEntries(
    Object.keys(defaults).map((name) => [
      name,
      !!form.formState.touchedFields[name] || !!errors[name],
    ])
  );
  function setField(name: string, update: SetStateAction<string>) {
    const previous = form.getValues(name) ?? '';
    const value = typeof update === 'function' ? update(previous) : update;
    if (value === previous) return;
    const state = form.getFieldState(name);
    form.setValue(name, value, {
      shouldDirty: true,
      shouldValidate: state.isTouched || state.invalid,
    });
  }
  function field(name: string): [string, Dispatch<SetStateAction<string>>] {
    return [values[name] ?? '', (update) => setField(name, update)];
  }
  function blur(name: string) {
    form.setValue(name, form.getValues(name) ?? '', { shouldTouch: true, shouldValidate: true });
  }
  return { form, values, field, setField, errors, touched, blur };
}
