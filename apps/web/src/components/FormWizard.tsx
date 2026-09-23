import type { ReactNode } from 'react';
import { Button } from '@barghsa/ui';

interface FormWizardProps {
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
  onBack,
  onSave,
  onNext,
  onSubmit,
}: FormWizardProps) {
  return (
    <>
      <nav aria-label={ariaLabel} className="mb-8">
        <ol className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
          {steps.map((label, index) => {
            const number = index + 1;
            return (
              <li
                key={label}
                aria-current={step === number ? 'step' : undefined}
                className={`flex items-center gap-2 rounded-full px-3 py-1.5 ${
                  step === number
                    ? 'bg-primary text-primary-foreground font-semibold'
                    : number < step
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                <span className="font-semibold">{number}.</span>
                {label}
              </li>
            );
          })}
        </ol>
      </nav>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        {step > 1 && (
          <Button variant="outline" disabled={saving || submitting} onClick={onBack}>
            {backLabel}
          </Button>
        )}
        <Button variant="outline" disabled={saveDisabled || saving || submitting} onClick={onSave}>
          {saving ? savingLabel : saveLabel}
        </Button>
        {step < steps.length ? (
          <Button className="ms-auto" disabled={nextDisabled || saving} onClick={onNext}>
            {saving ? savingLabel : nextLabel}
          </Button>
        ) : (
          <Button
            className="ms-auto"
            size="lg"
            disabled={submitDisabled || submitting}
            onClick={onSubmit}
          >
            {submitting ? submittingLabel : submitLabel}
          </Button>
        )}
      </div>
    </>
  );
}
