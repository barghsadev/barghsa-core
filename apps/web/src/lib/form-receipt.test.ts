import { describe, expect, it } from 'vitest';
import { confirmedDraftReceipt, electricityOrderReceipt } from './form-receipt.js';

const input = {
  profileId: 'buyer',
  currentStep: 3,
  data: {
    startAt: '2026-10-03T10:00:00.000Z',
    quantities: { thermal: '100', green: '0' },
    addressId: 'saved-address',
  },
};
describe('electricity save confirmation', () => {
  it('accepts persisted JSONB regardless of key ordering and without an echoed profile', () => {
    expect(
      confirmedDraftReceipt(
        {
          currentStep: 3,
          data: {
            addressId: 'saved-address',
            quantities: { green: '0', thermal: '100' },
            startAt: input.data.startAt,
          },
          updatedAt: '2026-10-02T10:00:00.000Z',
        },
        input
      )
    ).toBe(true);
  });
  it.each([
    null,
    [],
    { currentStep: 3 },
    { ...input, profileId: 'other-buyer' },
    { ...input, currentStep: 2 },
    { ...input, data: { ...input.data, addressId: 'other-address' } },
    { ...input, data: { ...input.data, quantities: { thermal: '101', green: '0' } } },
    { ...input, data: { ...input.data, quantities: { thermal: '100', green: 0 } } },
    { ...input, data: { ...input.data, giftCode: 'unexpected' } },
  ])('rejects an incomplete or different save receipt (%j)', (receipt) => {
    expect(confirmedDraftReceipt(receipt, input)).toBe(false);
  });
});

const order = {
  orderId: '11111111-1111-7111-8111-111111111111',
  contractId: '22222222-2222-7222-8222-222222222222',
  invoiceId: '33333333-3333-7333-8333-333333333333',
};
describe('electricity order confirmation', () => {
  it('accepts all three UUIDv7 references returned by order creation', () => {
    expect(electricityOrderReceipt({ ...order, totalIrR: '100000' })).toEqual(order);
  });
  it.each([
    null,
    [],
    {},
    { orderId: order.orderId },
    { ...order, invoiceId: '' },
    { ...order, contractId: 'not-a-uuid' },
    { ...order, orderId: 1 },
  ])('keeps a malformed result from releasing draft protection (%j)', (receipt) => {
    expect(() => electricityOrderReceipt(receipt)).toThrow();
  });
});
