import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type {
  FieldErrors,
  FieldPath,
  FieldValues,
  SubmitHandler,
  UseFormReturn,
} from 'react-hook-form';
import { Form } from './form';
import { firstErrorField } from './use-zod-form';

export interface FormStepActions {
  next: () => Promise<void>;
  submit: () => Promise<void>;
  pending: boolean;
}

export interface FormStepProps<Input extends FieldValues, Output extends FieldValues = Input> {
  form: UseFormReturn<Input, unknown, Output>;
  fields: readonly FieldPath<Input>[];
  /** Changes when navigation replaces a step, including two steps with no fields. */
  stepKey: string | number;
  disabled?: boolean;
  onNext: (values: Input) => void | Promise<void>;
  onSubmit: SubmitHandler<Output>;
  onInvalid?: (errors: FieldErrors<Input>, action: 'next' | 'submit') => void | Promise<void>;
  onPendingChange?: (pending: boolean) => void;
  children: (actions: FormStepActions) => ReactNode;
}

/** Keeps one form alive across steps. Next checks its named fields; Submit checks the full form. */
export function FormStep<Input extends FieldValues, Output extends FieldValues = Input>({
  form,
  fields,
  stepKey,
  disabled = false,
  onNext,
  onSubmit,
  onInvalid,
  onPendingChange,
  children,
}: FormStepProps<Input, Output>) {
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(true);
  const epoch = useRef(0);
  const [focus, setFocus] = useState<FieldPath<Input> | undefined>(undefined);
  const scope = `${stepKey}\0${fields.join('\0')}`;
  useLayoutEffect(() => {
    epoch.current++;
  }, [scope, disabled]);
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = form.subscribe({
      formState: { values: true },
      callback: () => {
        epoch.current++;
      },
    });
    return () => {
      mounted.current = false;
      epoch.current++;
      unsubscribe();
    };
  }, [form.subscribe]);
  useEffect(() => {
    if (!pending && focus) {
      form.setFocus(focus);
      setFocus(undefined);
    }
  }, [pending, focus, form.setFocus]);

  async function run(action: 'next' | 'submit') {
    if (locked.current || disabled) return;
    locked.current = true;
    const started = epoch.current;
    const current = () => mounted.current && started === epoch.current;
    setPending(true);
    try {
      onPendingChange?.(true);
      if (action === 'next') {
        // An empty review/instructions step has nothing to validate. trigger([]) can mean
        // all fields to a resolver, so never invoke it for this case.
        const valid = fields.length === 0 || (await form.trigger([...fields]));
        if (!current()) return;
        if (valid) await onNext(form.getValues());
        else {
          setFocus(fields.find((name) => form.getFieldState(name).invalid));
          await onInvalid?.(form.formState.errors, action);
        }
      } else {
        await form.handleSubmit(
          async (values, event) => {
            if (current()) await onSubmit(values, event);
          },
          async (errors) => {
            if (!current()) return;
            setFocus(firstErrorField(errors) as FieldPath<Input> | undefined);
            await onInvalid?.(errors, action);
          }
        )();
      }
    } finally {
      locked.current = false;
      if (mounted.current) setPending(false);
      onPendingChange?.(false);
    }
  }

  return (
    <Form {...form}>
      {children({ next: () => run('next'), submit: () => run('submit'), pending })}
    </Form>
  );
}
