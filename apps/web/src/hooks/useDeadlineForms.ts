import { tWorkspace as t } from '@barghsa/i18n/workspace-admin';
import { tDuePeriods } from '@barghsa/i18n/invoice-due-periods';
import { deadlineInstant } from '../lib/due-at-override.js';
import { useLocale } from './useLocale.js';
import { useWizardForm } from './useWizardForm.js';
import { useActionFieldErrors } from './useActionFieldErrors.js';
import type { DeadlineBasis, DeadlineDraft } from '../lib/deadline-form-schemas.js';
export function useDeadlineForm(source: DeadlineBasis): ReturnType<
  typeof useWizardForm<DeadlineDraft>
> & {
  applyServerErrors: (fields: unknown[]) => boolean;
} {
  const locale = useLocale();
  const messages = {
    dueAt: t('admin.invoices.error.dueAt', locale),
    reason: t('admin.invoices.error.reason', locale),
  };
  const draft = useWizardForm<DeadlineDraft>(
    async () => {
      const { deadlineSchema } = await import('../lib/deadline-form-schemas.js');
      return deadlineSchema(source, messages, (value) => deadlineInstant(value, source));
    },
    { dueAt: '', reason: '' },
    t('admin.invoices.validationUnavailable', locale)
  );
  return {
    ...draft,
    applyServerErrors: useActionFieldErrors(draft.form, messages, messages.dueAt),
  };
}
export function useDuePeriodForm(): ReturnType<
  typeof useWizardForm<{ serviceType: string; defaultDays: string }>
> & { applyServerErrors: (fields: unknown[]) => boolean } {
  const locale = useLocale();
  const messages = {
    serviceType: tDuePeriods('invalidService', locale),
    defaultDays: tDuePeriods('invalid', locale),
  };
  const draft = useWizardForm(
    async () => {
      const { duePeriodSchema } = await import('../lib/deadline-form-schemas.js');
      return duePeriodSchema(messages);
    },
    { serviceType: 'electricity', defaultDays: '7' },
    tDuePeriods('validationUnavailable', locale)
  );
  return {
    ...draft,
    applyServerErrors: useActionFieldErrors(draft.form, messages, messages.defaultDays),
  };
}
