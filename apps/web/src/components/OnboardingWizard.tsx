import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@barghsa/ui';
import { t } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import type { useOnboardingDraft } from '../hooks/useOnboardingDraft.js';
import { FormWizard } from './FormWizard.js';

interface Props {
  steps: { label: string; content: ReactNode; validate?: () => boolean }[];
  draft: ReturnType<typeof useOnboardingDraft>;
  submitting: boolean;
  disabled: boolean;
  onSubmit: () => Promise<void>;
}
export function OnboardingWizard({ steps, draft, submitting, disabled, onSubmit }: Props) {
  const locale = useLocale();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const region = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (step > 1) region.current?.focus();
  }, [step]);
  useEffect(() => {
    if (!draft.ready) setStep(1);
  }, [draft.ready]);
  const move = async (target: number) => {
    if (busy.current || submitting || !draft.ready) return;
    if (target > step && steps[step - 1]?.validate?.() === false) {
      requestAnimationFrame(() =>
        region.current
          ?.querySelector<HTMLElement>(':scope > fieldset:not([hidden]) [aria-invalid="true"]')
          ?.focus()
      );
      return;
    }
    busy.current = true;
    setSaving(true);
    try {
      const version = await draft.flush();
      if (version !== undefined && mounted.current) setStep(target);
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  const submit = async () => {
    if (busy.current || submitting || disabled || !draft.ready) return;
    const invalid = steps.findIndex((item) => item.validate?.() === false);
    if (invalid >= 0) {
      setStep(invalid + 1);
      requestAnimationFrame(() =>
        region.current
          ?.querySelector<HTMLElement>(':scope > fieldset:not([hidden]) [aria-invalid="true"]')
          ?.focus()
      );
      return;
    }
    busy.current = true;
    try {
      await onSubmit();
    } finally {
      busy.current = false;
    }
  };
  return (
    <form
      className="space-y-6"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled) return;
        if (step < steps.length) void move(step + 1);
        else void submit();
      }}
    >
      <div
        role="status"
        className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
      >
        <span>{t(`onboarding.draft.${draft.status}`, locale)}</span>
        {(draft.status === 'error' || draft.status === 'conflict') && (
          <Button
            type="button"
            variant="outline"
            disabled={saving || submitting}
            onClick={() => {
              if (draft.status === 'conflict' || !draft.ready) draft.reload();
              else void move(step);
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
        saving={saving || draft.status === 'saving'}
        submitting={submitting}
        saveDisabled={!draft.ready || disabled || draft.status === 'conflict'}
        nextDisabled={!draft.ready || disabled || draft.status === 'conflict'}
        submitDisabled={!draft.ready || disabled || draft.status === 'conflict'}
        backDisabled={disabled || !draft.ready || draft.status === 'conflict'}
        onBack={() => void move(step - 1)}
        onSave={() => void move(step)}
        onNext={() => void move(step + 1)}
        onSubmit={() => void submit()}
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
              disabled={index + 1 !== step || saving || submitting || disabled || !draft.ready}
              className="space-y-6"
            >
              <legend className="sr-only">{item.label}</legend>
              {item.content}
            </fieldset>
          ))}
        </div>
      </FormWizard>
    </form>
  );
}

export function OnboardingReview({ rows }: { rows: { label: string; value: string }[] }) {
  const locale = useLocale();
  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold">{t('onboarding.wizard.review', locale)}</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        {t('onboarding.wizard.reviewHelp', locale)}
      </p>
      <dl className="grid gap-4 sm:grid-cols-2">
        {rows
          .filter(({ value }) => value.trim())
          .map(({ label, value }) => (
            <div key={label} className="min-w-0">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="mt-1 whitespace-pre-wrap break-words font-medium">
                <bdi>{value}</bdi>
              </dd>
            </div>
          ))}
      </dl>
    </section>
  );
}
