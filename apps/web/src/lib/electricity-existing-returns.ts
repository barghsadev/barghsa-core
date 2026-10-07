import { isInvoiceUuid } from './due-at-override.js';
/** Existing wallet returns captured by the immutable draft financial review. */
export function existingDraftReturns(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Invalid existing draft returns');
  const ids = new Set<string>();
  return value.map((raw: unknown) => {
    if (
      !raw ||
      typeof raw !== 'object' ||
      !('refundId' in raw) ||
      typeof raw.refundId !== 'string' ||
      !isInvoiceUuid(raw.refundId) ||
      ids.has(raw.refundId) ||
      !('invoiceId' in raw) ||
      typeof raw.invoiceId !== 'string' ||
      !isInvoiceUuid(raw.invoiceId) ||
      !('amount' in raw) ||
      typeof raw.amount !== 'string' ||
      !/^[1-9][0-9]{0,18}$/.test(raw.amount) ||
      BigInt(raw.amount) > 9223372036854775807n ||
      !('refundState' in raw) ||
      !['Requested', 'Approved', 'Processing', 'Failed'].includes(String(raw.refundState)) ||
      !('job' in raw) ||
      (raw.job !== null &&
        (!raw.job ||
          typeof raw.job !== 'object' ||
          !('exhausted' in raw.job) ||
          typeof raw.job.exhausted !== 'boolean'))
    )
      throw new Error('Unbound existing draft return');
    ids.add(raw.refundId);
    return {
      id: raw.refundId,
      invoiceId: raw.invoiceId,
      amount: raw.amount,
      state: String(raw.refundState),
      exhausted: raw.job !== null && 'exhausted' in raw.job && raw.job.exhausted === true,
    };
  });
}
