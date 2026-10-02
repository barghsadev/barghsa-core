import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FormStep, type FieldPath, type FieldValues, type UseFormReturn } from '@barghsa/ui/form';
import { t } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import { FormWizard, type FormWizardProps } from './FormWizard.js';

export function ValidatedFormWizard<Input extends FieldValues>({
  form,
  fields,
  errorId,
  disabled,
  onInvalidStep,
  onPendingChange,
  children,
  onNext,
  onSubmit,
  ...wizard
}: Omit<FormWizardProps, 'children' | 'onNext' | 'onSubmit'> & {
  form: UseFormReturn<Input, unknown, Input>;
  fields: readonly (readonly { name: FieldPath<Input>; label: string }[])[];
  errorId: (name: FieldPath<Input>) => string;
  disabled: boolean;
  onInvalidStep: (step: number) => Promise<unknown>;
  onPendingChange: (pending: boolean) => void;
  onNext: () => Promise<unknown>;
  onSubmit: () => Promise<unknown>;
  children: (pending: boolean) => ReactNode;
}) {
  const locale = useLocale();
  const region = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<FieldPath<Input> | undefined>(undefined);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (pending || !focus) return;
    const frame = requestAnimationFrame(() => {
      const target = Array.from(region.current?.querySelectorAll<HTMLElement>('[name]') ?? []).find(
        (node) =>
          node.getAttribute('name') === focus &&
          !node.matches(':disabled') &&
          !node.closest('[hidden]')
      );
      target?.focus();
      setFocus(undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [pending, focus, wizard.step]);
  return (
    <FormStep
      form={form}
      fields={(fields[wizard.step - 1] ?? []).map(({ name }) => name)}
      stepKey={wizard.step}
      disabled={disabled}
      onNext={async () => {
        await onNext();
      }}
      onSubmit={async () => {
        await onSubmit();
      }}
      onPendingChange={(value) => {
        setPending(value);
        onPendingChange(value);
      }}
      onInvalid={async (_errors, action) => {
        const index =
          action === 'submit'
            ? fields.findIndex((items) =>
                items.some(({ name }) => form.getFieldState(name).invalid)
              )
            : wizard.step - 1;
        const first = fields[index]?.find(({ name }) => form.getFieldState(name).invalid);
        setFocus(first?.name);
        if (index >= 0 && index + 1 !== wizard.step) await onInvalidStep(index + 1);
      }}
    >
      {({ next, submit, pending: validating }) => (
        <div ref={region}>
          <FormWizard
            {...wizard}
            saving={wizard.saving || validating}
            onNext={() => void next()}
            onSubmit={() => void submit()}
          >
            {children(validating)}
            <div className="my-3 space-y-1" aria-live="polite">
              {(fields[wizard.step - 1] ?? [])
                .filter(({ name }) => form.getFieldState(name).invalid)
                .map(({ name, label }) => (
                  <p key={name} id={errorId(name)} className="text-sm text-destructive">
                    {label}:{' '}
                    {form.getFieldState(name).error?.message ??
                      t('formWizard.invalidField', locale)}
                  </p>
                ))}
            </div>
          </FormWizard>
        </div>
      )}
    </FormStep>
  );
}
