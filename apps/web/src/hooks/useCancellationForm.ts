import { contractText } from '@barghsa/i18n/contracts';
import type { FieldPath } from '@barghsa/ui/form';
import { useLocale } from './useLocale.js';
import { useWizardForm as useDraftForm } from './useWizardForm.js';
import { useActionFieldErrors } from './useActionFieldErrors.js';
import type { CancellationPreview } from '../lib/contract-cancellation.js';

type Destination = 'wallet' | 'external_bank';
export interface CancellationRequestValues {
  reason: string;
  preferredDestination: Destination;
}
export interface CancellationValues {
  reason: string;
  custom: boolean;
  lines: Record<string, { amount: string; destination: Destination }>;
}
export function useCancellationRequestForm(staff: boolean): ReturnType<
  typeof useDraftForm<CancellationRequestValues>
> & {
  applyServerErrors: (fields: unknown[]) => boolean;
} {
  const locale = useLocale();
  const reason = contractText('cancellationReasonInvalid', locale);
  const destination = contractText('cancellationDestinationInvalid', locale);
  const draft = useDraftForm<CancellationRequestValues>(
    async () => {
      const { cancellationRequestSchema } = await import('../lib/cancellation-form-schemas.js');
      return cancellationRequestSchema(reason, destination);
    },
    { reason: '', preferredDestination: 'wallet' },
    contractText('cancellationValidationUnavailable', locale)
  );
  const apply = useActionFieldErrors(
    draft.form,
    { reason, ...(!staff ? { preferredDestination: destination } : {}) } as Record<
      FieldPath<CancellationRequestValues>,
      string
    >,
    reason
  );
  return { ...draft, applyServerErrors: apply };
}
export function useCancellationDecisionForm(preview: CancellationPreview | null): ReturnType<
  typeof useDraftForm<CancellationValues>
> & {
  applyServerErrors: (fields: unknown[], invoiceIds: string[]) => boolean;
} {
  const locale = useLocale();
  const reason = contractText('cancellationReasonInvalid', locale);
  const amount = contractText('cancellationAmountInvalid', locale);
  const destination = contractText('cancellationDestinationInvalid', locale);
  const draft = useDraftForm<CancellationValues>(
    async () => {
      const { cancellationDecisionSchema } = await import('../lib/cancellation-form-schemas.js');
      return cancellationDecisionSchema(preview, reason, amount, destination);
    },
    { reason: '', custom: false, lines: {} },
    contractText('cancellationValidationUnavailable', locale)
  );
  const messages = Object.fromEntries([
    ['reason', reason],
    ...(preview?.invoices.flatMap(({ id }) => [
      [`lines.${id}.amount`, amount],
      [`lines.${id}.destination`, destination],
    ]) ?? []),
  ]) as Record<FieldPath<CancellationValues>, string>;
  const apply = useActionFieldErrors(draft.form, messages, reason);
  function applyServerErrors(fields: unknown[], invoiceIds: string[]) {
    const mapped = fields.map((field) => {
      if (field === 'reason') return field;
      if (typeof field !== 'string') return null;
      const match = /^refund(Amount|Destination)(0|[1-9][0-9]{0,2})$/.exec(field);
      const id = match && invoiceIds[Number(match[2])];
      return id ? `lines.${id}.${match![1] === 'Amount' ? 'amount' : 'destination'}` : null;
    });
    return mapped.every((field) => field !== null) && apply(mapped);
  }
  return { ...draft, applyServerErrors };
}
