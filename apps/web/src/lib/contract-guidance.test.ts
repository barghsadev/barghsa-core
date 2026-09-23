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
    customerContractNextAction({ state: 'AwaitingStaffReview', canAccept: false }, null)
  ).toEqual({ key: 'workflow.contract.awaitStaff', owner: 'staff', href: null });
  expect(customerContractNextAction({ state: 'Completed', canAccept: false }, null)).toEqual({
    key: 'workflow.none',
    owner: 'none',
    href: null,
  });
});
