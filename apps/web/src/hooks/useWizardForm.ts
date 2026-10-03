import { useCallback, useId, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  useWatch,
  useZodForm,
  type DefaultValues,
  type FieldPath,
  type FieldPathValue,
  type FieldValues,
} from '@barghsa/ui/form';
import type { RefCallback } from 'react';
import type { $ZodType } from 'zod/v4/core';

export interface WizardFieldBinding {
  name: string;
  ref: RefCallback<HTMLElement>;
  onBlur: () => void;
  'aria-invalid': boolean | undefined;
  'aria-describedby': string | undefined;
}

export function useWizardForm<Input extends FieldValues>(
  schema: $ZodType<Input, Input> | (() => Promise<$ZodType<Input, Input>>),
  initial: NoInfer<Input> | (() => NoInfer<Input>),
  validationUnavailableMessage?: string
) {
  const [defaults] = useState(initial);
  const form = useZodForm(schema, {
    defaultValues: defaults as DefaultValues<Input>,
    ...(validationUnavailableMessage ? { validationUnavailableMessage } : {}),
  });
  useWatch({ control: form.control });
  const errors = form.formState.errors;
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const prefix = useId();
  const setValidationPending = useCallback((value: boolean) => {
    busy.current = value;
    setPending(value);
  }, []);
  const isPending = useCallback(() => busy.current, []);
  const errorId = (name: FieldPath<Input>) => `${prefix}-${name}-error`;
  function field<Name extends FieldPath<Input>>(
    name: Name
  ): [FieldPathValue<Input, Name>, Dispatch<SetStateAction<FieldPathValue<Input, Name>>>] {
    return [
      form.getValues(name),
      (update) => {
        const previous = form.getValues(name);
        const value =
          typeof update === 'function'
            ? (update as (value: FieldPathValue<Input, Name>) => FieldPathValue<Input, Name>)(
                previous
              )
            : update;
        if (value === previous) return;
        const state = form.getFieldState(name);
        form.setValue(name, value, {
          shouldDirty: true,
          shouldValidate: state.isTouched || state.invalid,
        });
      },
    ];
  }
  function bind(name: FieldPath<Input>): WizardFieldBinding {
    const state = form.getFieldState(name);
    return {
      name,
      ref: form.register(name).ref,
      onBlur: () =>
        form.setValue(name, form.getValues(name), { shouldTouch: true, shouldValidate: true }),
      'aria-invalid': state.invalid || undefined,
      'aria-describedby': state.invalid ? errorId(name) : undefined,
    };
  }
  return {
    form,
    values: form.getValues(),
    field,
    bind,
    errors,
    pending,
    errorId,
    setValidationPending,
    isPending,
  };
}
