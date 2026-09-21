import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { formatCurrencyIrr, formatPercent } from '@barghsa/i18n/numbers';
import type { WalletPaymentReview } from '@barghsa/shared/finance';
import { WalletPaymentReviewSummary } from './WalletPaymentReviewSummary.js';

vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({
    money: (value: string) => formatCurrencyIrr(value, 'en'),
    number: (value: number) => String(value),
    percent: (value: number) => formatPercent(value, 'en'),
  }),
}));

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it.each([true, false])(
  'shows the actual VAT and remaining debit for taxable=%s',
  async (taxable) => {
    const profileId = '01900000-0000-7000-8000-000000000001';
    const invoiceId = '01900000-0000-7000-8000-000000000002';
    const subtotal = taxable ? '100000' : '109000',
      vat = taxable ? '9000' : '0';
    const review: WalletPaymentReview = {
      schemaVersion: 1,
      scope: { action: 'invoice.wallet-payment', profileId, resourceId: invoiceId },
      hash: 'a'.repeat(64),
      data: {
        currency: 'IRR',
        profile: { id: profileId, title: 'Customer', type: 'LEGAL' },
        invoice: {
          id: invoiceId,
          state: 'PartiallyFunded',
          orderId: null,
          serviceType: null,
          issuedAt: null,
          payableFrom: null,
          dueAt: null,
          totalAmount: '109000',
          paidAmount: '5000',
          remainingAmount: '104000',
        },
        lines: [
          {
            id: invoiceId,
            description: 'Electricity',
            quantity: 1,
            unitPrice: subtotal,
            discount: '0',
            subtotal,
            vatRate: 900,
            vatAmount: vat,
            taxable,
          },
        ],
        totals: { subtotal, discount: '0', vat },
        payment: { source: 'wallet', availableBefore: '200000', availableAfter: '96000' },
        contracts: [],
        cancellation: 'separate_review_required',
      },
    };
    await act(async () =>
      root.render(<WalletPaymentReviewSummary review={review} formatDate={(value) => value} />)
    );
    expect(host.textContent).toContain(formatCurrencyIrr(vat, 'en'));
    expect(host.textContent).toContain(formatPercent(taxable ? 0.09 : 0, 'en'));
    expect(host.querySelector('dl:last-of-type dd')?.textContent).toBe(
      formatCurrencyIrr('104000', 'en')
    );
    expect(host.textContent).toContain(formatCurrencyIrr('96000', 'en'));
  }
);
