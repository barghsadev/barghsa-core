import type { ReactNode } from 'react';
import { Button, ProgressStepper, cn } from '@barghsa/ui';
import { t } from '@barghsa/i18n/workspace';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

export const wizardActionSurface =
  'gap-1.5 rounded-xl border bg-card p-2 sm:gap-3 sm:px-4 max-sm:[&>button]:px-2.5';

export const wizardChoiceCard =
  'flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 hover:bg-muted/35 has-checked:border-primary has-checked:bg-primary/5 has-disabled:cursor-not-allowed has-disabled:bg-muted/30';
export const wizardChoiceRadio = 'mt-0.5 size-4 shrink-0 accent-primary';

export function WizardDraftAddressNotice() {
  const locale = useLocale();
  return (
    <p
      id="draft-address-unavailable"
      role="status"
      className="rounded-md border bg-muted/35 px-3 py-2 text-sm text-muted-foreground"
    >
      {t('electricity.order.savedAddressUnavailable', locale)}
    </p>
  );
}

export interface FormWizardProps {
  children: ReactNode | ((actions: ReactNode) => ReactNode);
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
  anchorNotices?: boolean;
  compactProgress?: boolean;
  hideProgress?: boolean;
  actionsClassName?: string;
  actionSummary?: ReactNode;
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
  anchorNotices,
  compactProgress = false,
  hideProgress = false,
  actionsClassName,
  actionSummary,
  onBack,
  onSave,
  onNext,
  onSubmit,
}: FormWizardProps) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const actions = (
    <div className={cn('flex flex-wrap items-center gap-3', actionsClassName)}>
      {actionSummary}
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
  );
  return (
    <>
      {!hideProgress && (
        <nav
          aria-label={ariaLabel}
          className={
            compactProgress
              ? 'mb-3 space-y-2 sm:mb-4'
              : anchorNotices
                ? 'mb-8 max-sm:[&>ol]:grid max-sm:[&>ol]:grid-cols-2 max-sm:[&>ol]:gap-3 max-sm:[&>ol>li]:pb-0 max-sm:[&>ol>li>.absolute]:hidden'
                : 'mb-8'
          }
          data-toast-anchor={anchorNotices || undefined}
        >
          {compactProgress && (
            <div
              aria-hidden="true"
              className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm sm:hidden"
            >
              <strong className="font-semibold">{steps[step - 1]}</strong>
              <span className="text-xs text-muted-foreground">
                {t('formWizard.stepOf', locale)
                  .replace('{step}', numbers.number(step))
                  .replace('{total}', numbers.number(steps.length))}
              </span>
            </div>
          )}
          <ProgressStepper
            label={ariaLabel}
            compactOnMobile={compactProgress}
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
      )}
      {typeof children === 'function' ? (
        children(actions)
      ) : (
        <>
          {children}
          {actions}
        </>
      )}
    </>
  );
}
