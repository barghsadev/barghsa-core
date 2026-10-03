import type { RefundOperation } from '../hooks/useRefundForm.js';
export function validRefundReceipt(
  result: unknown,
  expected: {
    id?: string;
    invoiceId: string;
    destination: 'wallet' | 'external_bank';
    amount: string;
  },
  states: string[],
  reference?: string,
  operation?: RefundOperation
): boolean {
  if (!result || typeof result !== 'object') return false;
  const value = result as Partial<{
    id: string;
    invoiceId: string;
    destination: string;
    amount: string;
    state: string;
    bankReference: string | null;
    reconciliationStatus: string | null;
  }>;
  return (
    typeof value.id === 'string' &&
    !!value.id &&
    (!expected.id || value.id === expected.id) &&
    value.invoiceId === expected.invoiceId &&
    value.destination === expected.destination &&
    value.amount === expected.amount &&
    typeof value.state === 'string' &&
    states.includes(value.state) &&
    (reference === undefined ||
      (value.bankReference === reference &&
        value.reconciliationStatus === (operation === 'reconcile' ? 'Confirmed' : 'Pending')))
  );
}
