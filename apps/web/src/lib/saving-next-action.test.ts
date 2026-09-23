import { expect, it } from 'vitest';
import { savingNextAction, type SavingActionContext } from './saving-next-action.js';

const order: SavingActionContext = {
  id: 'saving-id',
  status: 'approved',
  financial_status: 'unpaid',
  invoice_id: 'invoice-id',
  invoice_state: 'Unpaid',
  contract_id: 'contract-id',
  contract_state: 'AwaitingCustomerAcceptance',
  cancellation_pending: false,
};

it('shows the next customer step and links the matching record', () => {
  expect(savingNextAction({ ...order, status: 'awaiting_staff_review' })).toEqual({
    kind: 'awaitReview',
    href: null,
  });
  expect(savingNextAction(order)).toEqual({
    kind: 'acceptContract',
    href: '/contracts?contractId=contract-id',
  });
  expect(savingNextAction({ ...order, contract_state: 'Active' })).toEqual({
    kind: 'payInvoice',
    href: '/invoices/invoice-id',
  });
  expect(savingNextAction({ ...order, invoice_state: 'PaymentUnderReview' })).toEqual({
    kind: 'awaitPaymentReview',
    href: '/invoices/invoice-id',
  });
  expect(savingNextAction({ ...order, cancellation_pending: true })).toEqual({
    kind: 'awaitCancellation',
    href: null,
  });
  expect(
    savingNextAction({ ...order, status: 'cancelled', financial_status: 'refund_pending' })
  ).toEqual({
    kind: 'trackRefund',
    href: '/savings/orders/saving-id#saving-cancellation',
  });
  expect(
    savingNextAction({ ...order, status: 'rejected', financial_status: 'refund_pending' })
  ).toEqual({ kind: 'trackRefund', href: '/savings/orders/saving-id' });
  expect(savingNextAction({ ...order, status: 'completed' })).toEqual({
    kind: 'none',
    href: null,
  });
});
