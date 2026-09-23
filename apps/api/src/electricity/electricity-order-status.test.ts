import { expect, it } from 'vitest';
import {
  canTransitionElectricityOrder,
  electricityFinancialStatus,
  electricityNextAction,
} from './electricity-order-status.js';

it('permits review decisions and blocks terminal commercial transitions', () => {
  expect(canTransitionElectricityOrder('awaiting_staff_review', 'approved')).toBe(true);
  expect(canTransitionElectricityOrder('awaiting_staff_review', 'changes_requested')).toBe(true);
  expect(canTransitionElectricityOrder('changes_requested', 'submitted')).toBe(true);
  expect(canTransitionElectricityOrder('approved', 'active')).toBe(true);
  expect(canTransitionElectricityOrder('active', 'completed')).toBe(true);
  expect(canTransitionElectricityOrder('rejected', 'active')).toBe(false);
  expect(canTransitionElectricityOrder('completed', 'cancelled')).toBe(false);
});

it('derives financial status from confirmed invoice and refund amounts', () => {
  const base = {
    invoiceState: 'Unpaid',
    totalAmount: '1000',
    paidAmount: '0',
    refundedAmount: '0',
    pendingRefundAmount: '0',
  };
  expect(electricityFinancialStatus(base)).toBe('unpaid');
  expect(electricityFinancialStatus({ ...base, invoiceState: 'PaymentUnderReview' })).toBe(
    'payment_under_review'
  );
  expect(electricityFinancialStatus({ ...base, paidAmount: '300' })).toBe('partially_funded');
  expect(electricityFinancialStatus({ ...base, paidAmount: '1000' })).toBe('paid');
  expect(
    electricityFinancialStatus({ ...base, paidAmount: '1000', pendingRefundAmount: '1000' })
  ).toBe('refund_pending');
  expect(electricityFinancialStatus({ ...base, paidAmount: '1000', refundedAmount: '300' })).toBe(
    'partially_refunded'
  );
  expect(electricityFinancialStatus({ ...base, paidAmount: '1000', refundedAmount: '1000' })).toBe(
    'refunded'
  );
  expect(() =>
    electricityFinancialStatus({ ...base, paidAmount: '300', refundedAmount: '400' })
  ).toThrow();
});

it('shows the next actor without confusing commercial and financial progress', () => {
  expect(electricityNextAction('awaiting_staff_review', 'unpaid', 'staff')).toBe('review_order');
  expect(electricityNextAction('awaiting_staff_review', 'unpaid', 'customer')).toBe('await_review');
  expect(electricityNextAction('approved', 'unpaid', 'customer')).toBe('pay_invoice');
  expect(electricityNextAction('approved', 'paid', 'customer')).toBe('accept_contract');
  expect(electricityNextAction('rejected', 'refund_pending', 'customer')).toBe('await_refund');
});
