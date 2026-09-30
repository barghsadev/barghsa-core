import { expect, it } from 'vitest';
import { parseManualInvoiceReview } from './manual-invoice-review.js';

const profileId = '11111111-1111-4111-8111-111111111111';
const requestKey = '22222222-2222-4222-8222-222222222222';

function review() {
  return {
    schemaVersion: 1,
    hash: 'a'.repeat(64),
    scope: { action: 'invoice.manual-issue', profileId, resourceId: requestKey },
    data: {
      currency: 'IRR',
      profile: { id: profileId, title: 'Customer', profileType: 'INDIVIDUAL' },
      contractId: null,
      lines: [
        {
          description: 'Electricity service',
          quantity: 2,
          unitPrice: '100',
          vatRate: 1000,
          isTaxable: true,
          lineTotal: '200',
          vatAmount: '20',
        },
      ],
      totals: { subtotal: '200', vat: '20', discount: '0', total: '220' },
      dueRule: {
        source: 'config',
        configDays: 7,
        periodId: '33333333-3333-4333-8333-333333333333',
        serviceType: 'manual',
      },
      outcome: 'issue_unpaid_invoice',
    },
  };
}

it('accepts a reconciled manual invoice review', () => {
  expect(parseManualInvoiceReview(review())?.data.totals.total).toBe('220');
});

it('rejects a changed owner, VAT, or total', () => {
  const owner = review();
  owner.scope.profileId = requestKey;
  expect(parseManualInvoiceReview(owner)).toBeNull();
  const vat = review();
  vat.data.lines[0]!.vatAmount = '19';
  expect(parseManualInvoiceReview(vat)).toBeNull();
  const total = review();
  total.data.totals.total = '221';
  expect(parseManualInvoiceReview(total)).toBeNull();
});
