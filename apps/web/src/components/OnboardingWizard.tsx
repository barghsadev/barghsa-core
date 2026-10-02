import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useBlocker } from '@tanstack/react-router';
import { Button } from '@barghsa/ui';
import { FormStep, type FieldErrors, type UseFormReturn } from '@barghsa/ui/form';
import { t } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import type { useOnboardingDraft } from '../hooks/useOnboardingDraft.js';
import { FormWizard } from './FormWizard.js';
import { StepReviewPage } from './StepReviewPage.js';

const LeaveDialog = lazy(() => import('./WizardLeaveDialog.js'));

interface Props {
  steps: {
    label: string;
    content:
      | ReactNode
      | ((navigation: { onEdit: (step: number) => void; disabled: boolean }) => ReactNode);
    fields?: readonly string[];
  }[];
  form: UseFormReturn<Record<string, string>, unknown, Record<string, string>>;
  draft: ReturnType<typeof useOnboardingDraft>;
  submitting: boolean;
  disabled: boolean;
  working?: boolean;
  step: number;
  onStepChange: (step: number) => Promise<void>;
  onSubmit: () => Promise<void>;
}
export function OnboardingWizard({
  steps,
  form,
  draft,
  submitting,
  disabled,
  working = false,
  step: requestedStep,
  onStepChange,
  onSubmit,
}: Props) {
  const locale = useLocale();
  const step = draft.ready ? requestedStep : 1;
  const unavailable = disabled || !draft.ready || draft.isSubmitted();
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const validating = useRef(false);
  const [validationPending, setValidationPending] = useState(false);
  const invalidFocus = useRef(false);
  const region = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const stepRef = useRef(step);
  useLayoutEffect(() => {
    stepRef.current = step;
  }, [step]);
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      current.pathname !== next.pathname &&
      !draft.isSubmitted() &&
      (submitting || working || busy.current || validating.current || draft.hasUnsavedChanges()),
    enableBeforeUnload: () =>
      !draft.isSubmitted() &&
      (submitting || working || busy.current || validating.current || draft.hasUnsavedChanges()),
    withResolver: true,
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    region.current?.focus();
  }, [step]);
  const move = async (target: number) => {
    if (!Number.isInteger(target) || target < 1 || target > steps.length) return;
    if (busy.current || submitting || working || disabled || !draft.ready || draft.isSubmitted())
      return;
    busy.current = true;
    setSaving(true);
    try {
      const version = await draft.flush();
      if (version !== undefined && mounted.current && stepRef.current === step && target !== step)
        await onStepChange(target);
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  const submit = async () => {
    if (busy.current || submitting || disabled || !draft.ready || draft.isSubmitted()) return;
    busy.current = true;
    try {
      await onSubmit();
    } finally {
      busy.current = false;
    }
  };
  async function invalid(errors: FieldErrors<Record<string, string>>, action: 'next' | 'submit') {
    invalidFocus.current = true;
    if (action === 'submit') {
      const index = steps.findIndex((item) => item.fields?.some((name) => errors[name]));
      if (index >= 0 && index + 1 !== step) await onStepChange(index + 1);
    }
  }
  useEffect(() => {
    if (validationPending || saving || submitting || !invalidFocus.current) return;
    const frame = requestAnimationFrame(() => {
      invalidFocus.current = false;
      region.current
        ?.querySelector<HTMLElement>(':scope > fieldset:not([hidden]) [aria-invalid="true"]')
        ?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [validationPending, saving, submitting, step]);
  return (
    <FormStep
      form={form}
      fields={steps[step - 1]?.fields ?? []}
      stepKey={step}
      disabled={unavailable || submitting || working}
      onNext={() => move(step + 1)}
      onSubmit={submit}
      onInvalid={invalid}
      onPendingChange={(pending) => {
        validating.current = pending;
        setValidationPending(pending);
      }}
    >
      {({ next, submit: submitForm, pending }) => (
        <form
          className="space-y-6"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (disabled) return;
            if (step < steps.length) void next();
            else void submitForm();
          }}
        >
          {blocker.status === 'blocked' && (
            <Suspense>
              <LeaveDialog
                onSave={async () =>
                  (await draft.flush()) !== undefined && !draft.hasUnsavedChanges()
                }
                saveDisabled={!draft.ready || draft.status === 'conflict'}
                errorMessage={
                  draft.status === 'error' || draft.status === 'conflict'
                    ? t(`onboarding.draft.${draft.status}`, locale)
                    : undefined
                }
                working={pending || submitting || working || saving || draft.status === 'saving'}
                workingLabel={t(
                  submitting
                    ? 'onboarding.wizard.submitting'
                    : working
                      ? 'onboarding.documents.uploading'
                      : 'onboarding.draft.saving',
                  locale
                )}
                onStay={() => blocker.reset()}
                onLeave={() => blocker.proceed()}
              />
            </Suspense>
          )}
          <div
            role="status"
            className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
          >
            <span>{t(`onboarding.draft.${draft.status}`, locale)}</span>
            {(draft.status === 'error' || draft.status === 'conflict') && (
              <Button
                type="button"
                variant="outline"
                disabled={pending || saving || submitting}
                onClick={() => {
                  if (draft.status === 'conflict' || !draft.ready) {
                    void onStepChange(1);
                    draft.reload();
                  } else void move(step);
                }}
              >
                {t(
                  draft.status === 'conflict' || !draft.ready
                    ? 'onboarding.draft.reload'
                    : 'onboarding.draft.retry',
                  locale
                )}
              </Button>
            )}
          </div>
          <FormWizard
            steps={steps.map(({ label }) => label)}
            step={step}
            ariaLabel={t('onboarding.wizard.progress', locale)}
            backLabel={t('onboarding.wizard.back', locale)}
            saveLabel={t('onboarding.wizard.save', locale)}
            nextLabel={t('onboarding.wizard.next', locale)}
            submitLabel={t('onboarding.wizard.submit', locale)}
            savingLabel={t('onboarding.draft.saving', locale)}
            submittingLabel={t('onboarding.wizard.submitting', locale)}
            saving={pending || saving || draft.status === 'saving'}
            submitting={submitting}
            saveDisabled={unavailable || draft.status === 'conflict'}
            nextDisabled={unavailable || draft.status === 'conflict'}
            submitDisabled={unavailable || draft.status === 'conflict'}
            backDisabled={unavailable || draft.status === 'conflict'}
            onBack={() => void move(step - 1)}
            onSave={() => void move(step)}
            onNext={() => void next()}
            onSubmit={() => void submitForm()}
          >
            <div
              ref={region}
              tabIndex={-1}
              aria-label={steps[step - 1]?.label}
              className="rounded-xl border bg-card p-4 sm:p-6 focus-visible:outline-primary"
            >
              {steps.map((item, index) => (
                <fieldset
                  key={item.label}
                  hidden={index + 1 !== step}
                  disabled={index + 1 !== step || pending || saving || submitting || unavailable}
                  className="space-y-6"
                >
                  <legend className="sr-only">{item.label}</legend>
                  {typeof item.content === 'function'
                    ? item.content({
                        onEdit: (target) => void move(target),
                        disabled:
                          pending ||
                          saving ||
                          submitting ||
                          working ||
                          unavailable ||
                          draft.status === 'conflict',
                      })
                    : item.content}
                </fieldset>
              ))}
            </div>
          </FormWizard>
        </form>
      )}
    </FormStep>
  );
}

export function OnboardingReview({
  rows,
  onEdit,
  disabled,
  sectionTitles,
}: {
  rows: { label: string; value: string; step: number }[];
  sectionTitles: string[];
  onEdit: (step: number) => void;
  disabled: boolean;
}) {
  const locale = useLocale();
  return (
    <StepReviewPage
      title={t('onboarding.wizard.review', locale)}
      description={t('onboarding.wizard.reviewHelp', locale)}
      editLabel={t('electricity.order.edit', locale)}
      onEdit={onEdit}
      disabled={disabled}
      sections={sectionTitles.map((title, index) => ({
        id: String(index + 1),
        title,
        step: index + 1,
        rows: rows.filter((row) => row.step === index + 1 && row.value.trim()),
      }))}
    />
  );
}
