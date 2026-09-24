import { expect, it } from 'vitest';
import { customerContractNextAction } from './contract-guidance.js';

it('directs customers to contract acceptance before signature preparation', () => {
  expect(
    customerContractNextAction(
      { state: 'AwaitingCustomerAcceptance', canAccept: true },
      { canRequest: true, canRecord: false }
    )
  ).toEqual({ key: 'accept', owner: 'customer', href: '#contract-accept' });
});

it('links customer signature preparation and recording to the existing panel', () => {
  expect(
    customerContractNextAction(
      { state: 'AwaitingSignature', canAccept: false },
      { canRequest: true, canRecord: false }
    )
  ).toEqual({ key: 'prepareSignature', owner: 'customer', href: '#contract-signature' });
  expect(
    customerContractNextAction(
      { state: 'AwaitingSignature', canAccept: false },
      { canRequest: false, canRecord: true }
    )
  ).toEqual({ key: 'recordSignature', owner: 'customer', href: '#contract-signature' });
});

it('identifies staff waits and terminal states without offering a dead link', () => {
  expect(
    customerContractNextAction(
      {
        state: 'Active',
        canAccept: false,
        amendment: { state: 'AwaitingSignature', baseVersionId: 'current-version' },
      },
      null
    )
  ).toEqual({ key: 'workflow.contract.awaitStaff', owner: 'staff', href: null });
  expect(
    customerContractNextAction({ state: 'AwaitingStaffReview', canAccept: false }, null)
  ).toEqual({ key: 'workflow.contract.awaitStaff', owner: 'staff', href: null });
  expect(customerContractNextAction({ state: 'Completed', canAccept: false }, null)).toEqual({
    key: 'workflow.none',
    owner: 'none',
    href: null,
  });
});

it.each(['Unpaid', 'PartiallyFunded', 'Overdue'] as const)(
  'directs a customer with a %s initial invoice to payment',
  (initialInvoiceState) => {
    expect(
      customerContractNextAction(
        {
          state: 'Accepted',
          canAccept: false,
          initialInvoiceId: 'initial-invoice',
          initialInvoiceState,
        },
        null
      )
    ).toEqual({
      key: 'payInitialInvoice',
      owner: 'customer',
      href: '/invoices/initial-invoice',
    });
  }
);

it('shows a staff wait while the initial payment is being reviewed', () => {
  expect(
    customerContractNextAction(
      {
        state: 'Signed',
        canAccept: false,
        initialInvoiceId: 'initial-invoice',
        initialInvoiceState: 'PaymentUnderReview',
      },
      null
    )
  ).toEqual({ key: 'initialPaymentUnderReview', owner: 'staff', href: null });
});

it('keeps acceptance, signature, and completed contracts ahead of invoice guidance', () => {
  const invoice = { initialInvoiceId: 'initial-invoice', initialInvoiceState: 'Unpaid' } as const;
  expect(
    customerContractNextAction(
      { state: 'AwaitingCustomerAcceptance', canAccept: true, ...invoice },
      null
    ).key
  ).toBe('accept');
  expect(
    customerContractNextAction(
      { state: 'AwaitingSignature', canAccept: false, ...invoice },
      { canRequest: true, canRecord: false }
    ).key
  ).toBe('prepareSignature');
  expect(
    customerContractNextAction({ state: 'Completed', canAccept: false, ...invoice }, null)
  ).toEqual({ key: 'workflow.none', owner: 'none', href: null });
});
