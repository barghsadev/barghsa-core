import { z } from 'zod/mini';
import {
  parseBankReceiptRejectReason,
  parseInvoiceBankReceiptRejectReason,
} from '@barghsa/shared/finance';
import { tWalletReceipts as walletText } from '@barghsa/i18n/wallet-receipts';
import { t as adminText } from '@barghsa/i18n/admin-ui';
import { useLocale } from './useLocale.js';
import { useWizardForm as useDraftForm } from './useWizardForm.js';
import { useActionFieldErrors } from './useActionFieldErrors.js';

interface RejectionValues {
  reason: string;
}
type RejectionDraft = ReturnType<typeof useDraftForm<RejectionValues>> & {
  applyServerErrors: (names: unknown[]) => boolean;
};
export function useReceiptRejectionForm(kind: 'wallet' | 'invoice'): RejectionDraft {
  const locale = useLocale();
  const message =
    kind === 'wallet'
      ? walletText('admin.walletReceipts.error.reason', locale)
      : adminText('admin.invoiceReceipts.invalidReason', locale);
  const parse =
    kind === 'wallet' ? parseBankReceiptRejectReason : parseInvoiceBankReceiptRejectReason;
  const draft = useDraftForm<RejectionValues>(
    z.object({ reason: z.string().check(z.refine((reason) => parse({ reason }).ok, message)) }),
    { reason: '' }
  );
  const applyServerErrors = useActionFieldErrors(draft.form, { reason: message }, message);
  return { ...draft, applyServerErrors };
}
