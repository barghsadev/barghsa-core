import { describe, expect, it } from 'vitest';
import { solarNextAction } from './solar-next-action.js';

const contractId = '11111111-1111-4111-8111-111111111111';
const invoiceId = '22222222-2222-4222-8222-222222222222';
const request = {
  status: 'contract_created',
  contract_id: contractId,
  contract_published: false,
  initial_invoice_id: invoiceId,
  initial_invoice_state: 'Unpaid',
};

describe('solar contract and invoice next actions', () => {
  it.each(['Unpaid', 'PartiallyFunded', 'Overdue'])(
    'sends a customer with an %s invoice to payment',
    (state) => {
      const action = solarNextAction({ ...request, initial_invoice_state: state }, 'en');
      expect(action).toMatchObject({
        owner: 'customer',
        href: `/invoices/${invoiceId}`,
        text: 'Review and pay the issued invoice.',
      });
    }
  );

  it('shows staff ownership while a payment is under review', () => {
    expect(
      solarNextAction({ ...request, initial_invoice_state: 'PaymentUnderReview' }, 'fa')
    ).toMatchObject({
      owner: 'staff',
      text: 'پرداخت فاکتور شما در حال بررسی کارشناس است.',
    });
  });

  it('returns to contract publication and acceptance after payment', () => {
    expect(solarNextAction({ ...request, initial_invoice_state: 'Paid' }, 'en')).toMatchObject({
      owner: 'staff',
      text: 'Contract draft is under staff review.',
    });
    expect(
      solarNextAction({ ...request, initial_invoice_state: 'Paid', contract_published: true }, 'en')
    ).toMatchObject({ owner: 'customer', href: `/contracts?contractId=${contractId}` });
  });
});
