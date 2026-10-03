import { expect, it } from 'vitest';
import {
  en,
  fa,
  tInvoiceFinancialReview,
  type InvoiceFinancialReviewKey,
} from './invoice-financial-review.js';
import { tWalletInvoicePayment } from './wallet-invoice-payment.js';

it('preserves the existing financial-review wording in both languages', () => {
  expect(Object.keys(fa).sort()).toEqual(Object.keys(en).sort());
  for (const locale of ['en', 'fa'] as const)
    for (const key of Object.keys(en) as InvoiceFinancialReviewKey[])
      expect(tInvoiceFinancialReview(key, locale)).toBe(tWalletInvoicePayment(key, locale));
});
