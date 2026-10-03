import { t } from '@barghsa/i18n/app';
import { useLocale } from './useLocale.js';
import { useWizardForm as useDraftForm } from './useWizardForm.js';
import { useActionFieldErrors } from './useActionFieldErrors.js';
import type { ReceiptFormValues } from '../lib/customer-finance-form-schemas.js';
const publicFields = {
  amount: 'amount',
  paymentDate: 'paymentDate',
  payerReference: 'payerReference',
  bankName: 'bankName',
  customerNote: 'customerNote',
  attachmentKey: 'file',
} as const;
type ReceiptDraft = ReturnType<typeof useDraftForm<ReceiptFormValues>> & {
  applyServerErrors: (names: unknown[] | undefined) => boolean;
};
export function useReceiptForm(
  kind: 'wallet' | 'invoice',
  parseAmount: (raw: string) => bigint | null
): ReceiptDraft {
  const locale = useLocale();
  const prefix = kind === 'wallet' ? 'wallet.page' : 'invoices.details';
  const messages = {
    amount: t(
      kind === 'wallet' ? 'wallet.page.invalidAmount' : 'invoices.details.receiptInvalidAmount',
      locale
    ),
    paymentDate: t(`${prefix}.receiptInvalidDate`, locale),
    payerReference: t(`${prefix}.receiptInvalidPayerRef`, locale),
    bankName: t('wallet.page.receiptInvalidBankName', locale),
    customerNote: t('invoices.details.receiptInvalidNote', locale),
    file: t(`${prefix}.receiptInvalidFile`, locale),
  };
  const draft = useDraftForm<ReceiptFormValues>(
    async () => {
      const { createReceiptFormSchema } = await import('../lib/customer-finance-form-schemas.js');
      return createReceiptFormSchema(parseAmount, messages);
    },
    { amount: '', paymentDate: '', payerReference: '', bankName: '', customerNote: '', file: null },
    t(`${prefix}.receiptGenericError`, locale)
  );
  const mapErrors = useActionFieldErrors(
    draft.form,
    messages,
    t(`${prefix}.receiptGenericError`, locale)
  );
  return {
    ...draft,
    applyServerErrors: (names) => {
      if (
        !names?.length ||
        !names.every((name) => typeof name === 'string' && Object.hasOwn(publicFields, name))
      )
        return false;
      return mapErrors(names.map((name) => publicFields[name as keyof typeof publicFields]));
    },
  };
}
