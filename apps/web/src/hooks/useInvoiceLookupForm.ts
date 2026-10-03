import { tManualInvoice } from '@barghsa/i18n/manual-invoice';
import { useLocale } from './useLocale.js';
import { useWizardForm as useDraftForm } from './useWizardForm.js';

export function useInvoiceLookupForm(
  message: string
): ReturnType<typeof useDraftForm<{ invoiceId: string }>> {
  const locale = useLocale();
  return useDraftForm(
    async () => {
      const { invoiceLookupSchema } = await import('../lib/invoice-form-schemas.js');
      return invoiceLookupSchema(message);
    },
    { invoiceId: '' },
    tManualInvoice('admin.manualInvoice.validationUnavailable', locale)
  );
}
