export type InvoiceReceiptDecision = 'confirm' | 'reject';

export function invoiceReceiptDecision(
  value: string | undefined
): InvoiceReceiptDecision | undefined {
  return value === 'confirm' || value === 'reject' ? value : undefined;
}
