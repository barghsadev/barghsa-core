import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { rememberWalletInvoiceReturn, walletInvoiceReturnFor } from './wallet-invoice-return.js';

const topUpId = '33333333-3333-7333-8333-333333333333';
const otherTopUpId = '44444444-4444-7444-8444-444444444444';
const invoiceId = '11111111-1111-7111-8111-111111111111';

beforeEach(() => {
  window.sessionStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-24T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  window.sessionStorage.clear();
});

it('restores only the invoice bound to the returned top-up in the same tab', () => {
  rememberWalletInvoiceReturn(topUpId, invoiceId);
  expect(walletInvoiceReturnFor(topUpId)).toBe(invoiceId);
  expect(walletInvoiceReturnFor(otherTopUpId)).toBeNull();
  expect(walletInvoiceReturnFor('invalid')).toBeNull();
});

it('drops expired or malformed return references', () => {
  rememberWalletInvoiceReturn(topUpId, invoiceId);
  vi.setSystemTime(new Date('2026-09-25T12:00:01Z'));
  expect(walletInvoiceReturnFor(topUpId)).toBeNull();
  expect(window.sessionStorage.length).toBe(0);
  rememberWalletInvoiceReturn(topUpId, 'invalid');
  expect(walletInvoiceReturnFor(topUpId)).toBeNull();
});
