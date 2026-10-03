import { InputFieldException } from '../common/input-field.exception.js';

const fields = new Set([
  'amount',
  'paymentDate',
  'payerReference',
  'bankName',
  'customerNote',
  'attachmentKey',
]);
/** Protected review/idempotency fields and unknown keys retain the generic parse error. */
export function throwReceiptFieldErrors(issues: readonly { path: readonly PropertyKey[] }[]): void {
  const names = issues.map((issue) => issue.path[0]);
  if (
    names.length &&
    names.every((name): name is string => typeof name === 'string' && fields.has(name))
  )
    throw new InputFieldException(names);
}
