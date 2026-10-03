import { tManualInvoice } from '@barghsa/i18n/manual-invoice';
import type { FieldPath } from '@barghsa/ui/form';
import { useLocale } from './useLocale.js';
import { useWizardForm as useDraftForm } from './useWizardForm.js';
import { useActionFieldErrors } from './useActionFieldErrors.js';
import type { InvoiceDraftValues } from '../lib/invoice-draft.js';
export function useInvoiceDraftForm(
  kind: 'manual' | 'replacement' | 'adjustment',
  initial: () => InvoiceDraftValues
): ReturnType<typeof useDraftForm<InvoiceDraftValues>> & {
  applyServerErrors: (fields: unknown[], lineIds: string[]) => boolean;
} {
  const locale = useLocale();
  const text = (key: string) => tManualInvoice('admin.manualInvoice.' + key, locale);
  const messages = {
    profileId: text('profileInvalid'),
    reason: text('reasonInvalid'),
    amount: text('amountInvalid'),
    lines: text('linesInvalid'),
    description: text('descriptionInvalid'),
    quantity: text('quantityInvalid'),
    unitPrice: text('priceInvalid'),
    vat: text('vatInvalid'),
  };
  const draft = useDraftForm<InvoiceDraftValues>(
    async () => {
      const { invoiceDraftSchema } = await import('../lib/invoice-form-schemas.js');
      return invoiceDraftSchema(kind, messages);
    },
    initial,
    text('validationUnavailable')
  );
  const owned = Object.fromEntries([
    ...(kind === 'manual' ? [['profileId', messages.profileId]] : [['reason', messages.reason]]),
    ...(kind === 'adjustment'
      ? [['amount', messages.amount]]
      : [
          ['lines', messages.lines],
          ...draft.values.lineOrder.flatMap((id) =>
            (['description', 'quantity', 'unitPrice', 'vat'] as const).map((key) => [
              `lines.${id}.${key}`,
              messages[key],
            ])
          ),
        ]),
  ]) as Record<FieldPath<InvoiceDraftValues>, string>;
  const apply = useActionFieldErrors(draft.form, owned, messages.lines);
  function applyServerErrors(fields: unknown[], lineIds: string[]) {
    const mapped = fields.map((field) => {
      if (typeof field !== 'string') return null;
      if (['profileId', 'reason', 'amount', 'lines'].includes(field)) return field;
      const match = /^line(Description|Quantity|UnitPrice|VatRate)(0|[1-9][0-9]?)$/.exec(field);
      const id = match && lineIds[Number(match[2])];
      const keys: Record<string, string> = {
        Description: 'description',
        Quantity: 'quantity',
        UnitPrice: 'unitPrice',
        VatRate: 'vat',
      };
      const key = keys[match?.[1] ?? ''];
      return id && key ? `lines.${id}.${key}` : null;
    });
    return mapped.every((field) => field !== null) && apply(mapped);
  }
  return { ...draft, applyServerErrors };
}
