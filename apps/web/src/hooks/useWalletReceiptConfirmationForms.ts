import { z } from 'zod/mini';
import { APPROVAL_REVIEW_REASON_MAX_LENGTH, parseOptionalInvoiceId } from '@barghsa/shared/finance';
import { tWalletReceipts as t } from '@barghsa/i18n/wallet-receipts';
import { useLocale } from './useLocale.js';
import { useWizardForm as useDraftForm } from './useWizardForm.js';
import { useActionFieldErrors } from './useActionFieldErrors.js';

interface InvoiceValues {
  invoiceId: string;
}
interface EmergencyValues {
  emergencyOverrideReason: string;
}
type Draft<Values extends InvoiceValues | EmergencyValues> = ReturnType<
  typeof useDraftForm<Values>
> & {
  applyServerErrors: (fields: unknown[]) => boolean;
};
export function useWalletReceiptConfirmationForms(): {
  invoice: Draft<InvoiceValues>;
  emergency: Draft<EmergencyValues>;
} {
  const locale = useLocale();
  const invoiceMessage = t('admin.walletReceipts.error.invoiceId', locale);
  const emergencyMessage = t('admin.walletReceipts.error.emergencyReason', locale);
  const invoice = useDraftForm<InvoiceValues>(
    z.object({
      invoiceId: z
        .string()
        .check(
          z.refine(
            (invoiceId) => parseOptionalInvoiceId({ invoiceId: invoiceId.trim() }).ok,
            invoiceMessage
          )
        ),
    }),
    { invoiceId: '' }
  );
  const emergency = useDraftForm<EmergencyValues>(
    z.object({
      emergencyOverrideReason: z
        .string()
        .check(
          z.refine(
            (reason) =>
              reason.trim().length > 0 && reason.trim().length <= APPROVAL_REVIEW_REASON_MAX_LENGTH,
            emergencyMessage
          )
        ),
    }),
    { emergencyOverrideReason: '' }
  );
  const invoiceErrors = useActionFieldErrors(
    invoice.form,
    { invoiceId: invoiceMessage },
    invoiceMessage
  );
  const emergencyErrors = useActionFieldErrors(
    emergency.form,
    { emergencyOverrideReason: emergencyMessage },
    emergencyMessage
  );
  return {
    invoice: { ...invoice, applyServerErrors: invoiceErrors },
    emergency: { ...emergency, applyServerErrors: emergencyErrors },
  };
}
