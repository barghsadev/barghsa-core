import { inputErrorFields } from './input-error-fields.js';
import type { BankReceiptTopUpReview } from '@barghsa/shared/finance';
import { withCsrf } from './csrf.js';

export interface BankReceiptTopUpDetails {
  profileId: string;
  amountIrR: string;
  paymentDate: string;
  payerReference: string;
  attachmentKey: string;
  customerNote: string | null;
  bankName?: string;
  idempotencyKey: string;
}

export type BankReceiptTopUpActionResult<T> =
  { kind: 'success'; value: T } | { kind: 'error'; status: number; fields?: unknown[] };

export async function loadBankReceiptTopUpReview(
  details: BankReceiptTopUpDetails,
  read: (
    path: string,
    options: RequestInit
  ) => Promise<Pick<Response, 'ok' | 'status' | 'json'>> = fetch
): Promise<BankReceiptTopUpActionResult<BankReceiptTopUpReview>> {
  const response = await read(`/api/wallet/${details.profileId}/bank-receipt-top-ups/review`, {
    method: 'POST',
    credentials: 'include',
    headers: withCsrf({ Accept: 'application/json', 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      amount: details.amountIrR,
      paymentDate: details.paymentDate,
      payerReference: details.payerReference,
      attachmentKey: details.attachmentKey,
      customerNote: details.customerNote ?? undefined,
      bankName: details.bankName,
      idempotencyKey: details.idempotencyKey,
    }),
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok)
    return {
      kind: 'error',
      status: response.status,
      ...inputErrorFields(payload, response.status),
    };
  const { parseBankReceiptTopUpReview } = await import('@barghsa/shared/finance');
  const review = parseBankReceiptTopUpReview(payload);
  if (
    !review ||
    review.data.profileId !== details.profileId ||
    review.data.amountIrR !== details.amountIrR ||
    review.data.paymentDate !== details.paymentDate ||
    review.data.payerReference !== details.payerReference ||
    review.data.attachmentKey !== details.attachmentKey ||
    review.data.customerNote !== details.customerNote ||
    (review.data.bankName ?? null) !== (details.bankName ?? null)
  )
    return { kind: 'error', status: 409 };
  return { kind: 'success', value: review };
}

export async function submitReviewedBankReceiptTopUp(
  review: BankReceiptTopUpReview,
  idempotencyKey: string
): Promise<BankReceiptTopUpActionResult<string>> {
  const response = await fetch(`/api/wallet/${review.data.profileId}/bank-receipt-top-ups`, {
    method: 'POST',
    credentials: 'include',
    headers: withCsrf({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    }),
    body: JSON.stringify({
      amount: review.data.amountIrR,
      paymentDate: review.data.paymentDate,
      payerReference: review.data.payerReference,
      attachmentKey: review.data.attachmentKey,
      customerNote: review.data.customerNote ?? undefined,
      bankName: review.data.bankName ?? undefined,
      expectedReviewHash: review.hash,
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    transactionId?: unknown;
    state?: unknown;
    amount?: unknown;
  };
  if (!response.ok)
    return {
      kind: 'error',
      status: response.status,
      ...inputErrorFields(payload, response.status),
    };
  if (
    payload.state !== 'Pending' ||
    payload.amount !== review.data.amountIrR ||
    typeof payload.transactionId !== 'string'
  )
    return { kind: 'error', status: 409 };
  return { kind: 'success', value: payload.transactionId };
}
