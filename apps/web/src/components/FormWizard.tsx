import type { ReactNode } from 'react';
import { Button, ProgressStepper } from '@barghsa/ui';
import { t } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

export interface FormWizardProps {
  children: ReactNode;
  steps: readonly string[];
  step: number;
  ariaLabel: string;
  backLabel: string;
  saveLabel: string;
  nextLabel: string;
  submitLabel: string;
  savingLabel: string;
  submittingLabel: string;
  saving: boolean;
  submitting: boolean;
  saveDisabled: boolean;
  nextDisabled: boolean;
  submitDisabled: boolean;
  backDisabled?: boolean;
  onBack: () => void;
  onSave: () => void;
  onNext: () => void;
  onSubmit: () => void;
}

export function FormWizard({
  children,
  steps,
  step,
  ariaLabel,
  backLabel,
  saveLabel,
  nextLabel,
  submitLabel,
  savingLabel,
  submittingLabel,
  saving,
  submitting,
  saveDisabled,
  nextDisabled,
  submitDisabled,
  backDisabled = false,
  onBack,
  onSave,
  onNext,
  onSubmit,
}: FormWizardProps) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  return (
    <>
      <nav aria-label={ariaLabel} className="mb-8">
        <ProgressStepper
          label={ariaLabel}
          steps={steps.map((label, index) => ({
            id: String(index + 1),
            label,
            number: numbers.number(index + 1),
            state: index + 1 === step ? 'current' : index + 1 < step ? 'complete' : 'pending',
            stateLabel: t(
              index + 1 === step
                ? 'formWizard.current'
                : index + 1 < step
                  ? 'formWizard.completed'
                  : 'formWizard.pending',
              locale
            ),
          }))}
        />
      </nav>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        {step > 1 && (
          <Button
            type="button"
            variant="outline"
            disabled={backDisabled || saving || submitting}
            onClick={onBack}
          >
            {backLabel}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={saveDisabled || saving || submitting}
          onClick={onSave}
        >
          {saving ? savingLabel : saveLabel}
        </Button>
        {step < steps.length ? (
          <Button
            type="button"
            className="ms-auto"
            disabled={nextDisabled || saving || submitting}
            onClick={onNext}
          >
            {saving ? savingLabel : nextLabel}
          </Button>
        ) : (
          <Button
            type="button"
            className="ms-auto"
            size="lg"
            disabled={submitDisabled || submitting || saving}
            onClick={onSubmit}
          >
            {submitting ? submittingLabel : submitLabel}
          </Button>
        )}
      </div>
    </>
  );
}
