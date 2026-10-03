import { useRef, type RefObject } from 'react';
import { contractText } from '@barghsa/i18n/contracts';
import { useLocale } from './useLocale.js';
import { useWizardForm as useDraftForm } from './useWizardForm.js';
import { useActionFieldErrors } from './useActionFieldErrors.js';

export type RefundOperation =
  'approve' | 'reject' | 'cancel' | 'process' | 'record-transfer' | 'reconcile';
export interface RefundRequestValues {
  amount: string;
  reason: string;
}
export interface RefundDecisionValues {
  reason: string;
  bankReference: string;
}
export function useRefundLookupForm(
  invoiceId: string,
  message: string
): ReturnType<typeof useDraftForm<{ invoiceId: string }>> {
  const locale = useLocale();
  return useDraftForm(
    async () => {
      const { refundLookupSchema } = await import('../lib/refund-form-schemas.js');
      return refundLookupSchema(message);
    },
    { invoiceId },
    contractText('cancellationValidationUnavailable', locale)
  );
}
export function useRefundRequestForm(available: string): ReturnType<
  typeof useDraftForm<RefundRequestValues>
> & {
  applyServerErrors: (fields: unknown[]) => boolean;
} {
  const locale = useLocale();
  const messages = {
    amount: contractText('refundAmountInvalid', locale),
    reason: contractText('cancellationReasonInvalid', locale),
  };
  const draft = useDraftForm<RefundRequestValues>(
    async () => {
      const { refundRequestFormSchema } = await import('../lib/refund-form-schemas.js');
      return refundRequestFormSchema(available, messages.amount, messages.reason);
    },
    { amount: '', reason: '' },
    contractText('cancellationValidationUnavailable', locale)
  );
  const applyServerErrors = useActionFieldErrors(draft.form, messages, messages.reason);
  return { ...draft, applyServerErrors };
}
export function useRefundDecisionForm(
  recordedReference: string | null,
  initial: RefundDecisionValues,
  referenceOnly = false
): ReturnType<typeof useDraftForm<RefundDecisionValues>> & {
  operation: RefObject<RefundOperation | null>;
  applyServerErrors: (fields: unknown[]) => boolean;
} {
  const locale = useLocale();
  const operation = useRef<RefundOperation | null>(null);
  const messages = {
    reason: contractText('cancellationReasonInvalid', locale),
    bankReference: contractText('refundBankReferenceInvalid', locale),
    mismatch: contractText('refundBankReferenceMismatch', locale),
  };
  const draft = useDraftForm<RefundDecisionValues>(
    async () => {
      const { refundDecisionFormSchema } = await import('../lib/refund-form-schemas.js');
      return refundDecisionFormSchema(operation.current, recordedReference, messages);
    },
    initial,
    contractText('cancellationValidationUnavailable', locale)
  );
  const apply = useActionFieldErrors(
    draft.form,
    referenceOnly
      ? ({ bankReference: messages.bankReference } as Record<keyof RefundDecisionValues, string>)
      : { reason: messages.reason, bankReference: messages.bankReference },
    messages.reason
  );
  return { ...draft, operation, applyServerErrors: apply };
}
