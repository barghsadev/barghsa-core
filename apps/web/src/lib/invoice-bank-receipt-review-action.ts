import { inputErrorFields } from './input-error-fields.js';
import type { InvoiceBankReceiptSubmissionReview } from '@barghsa/shared/finance';
import { withCsrf } from './csrf.js';

export async function loadInvoiceBankReceiptSubmissionReview(input: {
  invoiceId: string;
  amountIrR: string;
  paymentDate: string;
  payerReference: string;
  bankName: string | null;
  attachmentKey: string;
  customerNote: string | null;
}): Promise<
  | { kind: 'success'; review: InvoiceBankReceiptSubmissionReview }
  | { kind: 'error'; status: number; fields?: unknown[] }
> {
  const response = await fetch(`/api/invoices/${input.invoiceId}/bank-receipts/review`, {
    method: 'POST',
    credentials: 'include',
    headers: withCsrf({ Accept: 'application/json', 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      amount: input.amountIrR,
      paymentDate: input.paymentDate,
      payerReference: input.payerReference,
      bankName: input.bankName ?? undefined,
      attachmentKey: input.attachmentKey,
      customerNote: input.customerNote ?? undefined,
    }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok)
    return {
      kind: 'error',
      status: response.status,
      ...inputErrorFields(payload, response.status),
    };
  const { parseInvoiceBankReceiptSubmissionReview } = await import('@barghsa/shared/finance');
  const review = parseInvoiceBankReceiptSubmissionReview(payload);
  if (
    !review ||
    review.data.invoiceId !== input.invoiceId ||
    review.data.amountIrR !== input.amountIrR ||
    review.data.paymentDate !== input.paymentDate ||
    review.data.payerReference !== input.payerReference ||
    review.data.bankName !== input.bankName ||
    review.data.attachmentKey !== input.attachmentKey ||
    review.data.customerNote !== input.customerNote
  )
    return { kind: 'error', status: 409 };
  return { kind: 'success', review };
}
