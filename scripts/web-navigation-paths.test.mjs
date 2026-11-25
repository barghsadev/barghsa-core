import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isRegisteredWebPath } from './web-navigation-paths.mjs';

test('matches concrete destinations under registered customer and staff routes', () => {
  for (const path of [
    '/',
    '/savings/',
    '/electricity/orders/order-1',
    '/electricity/orders/order-1/cancel',
    '/electricity/orders/order-1/increases/new',
    '/savings/orders/order-1',
    '/solar/requests/request-1',
    '/solar/requests/request-1/documents',
    '/solar/requests/request-1/shipment',
    '/consultations/request-1',
    '/consultations/request-1/reply',
    '/consultations/request-1/offer',
    '/admin/consultations/request-1/fee',
    '/admin/consultations/request-1/decisions/request-info',
    '/admin/electricity-orders/order-1/decisions/request-changes',
    '/admin/saving-orders/order-1',
    '/admin/saving-orders/order-1/equipment-handover',
    '/admin/saving-orders/order-1/installation-address',
    '/admin/saving-orders/order-1/hardware',
    '/admin/saving-orders/order-1/cancel-upgrade/upgrade-1',
    '/invoices/invoice-1',
    '/admin/wallet-ledger/profile-1',
    '/admin/wallet-receipts/receipt-1/confirm',
    '/admin/wallet-receipts/receipt-1/reject',
    '/admin/wallet-receipts/receipt-1/emergency',
    '/admin/invoices/receipts/receipt-1/confirm',
    '/admin/invoices/receipts/receipt-1/reject',
    '/admin/invoices/invoice-1/refunds',
    '/admin/invoices/invoice-1/refunds/wallet/new',
    '/admin/invoices/invoice-1/refunds/bank',
    '/admin/invoices/invoice-1/refunds/bank/new',
    '/admin/invoices/invoice-1/refunds/bank/refund-1/record-transfer',
    '/admin/invoices/invoice-1/refunds/wallet/refund-1/approve',
    '/admin/contracts/refunds',
    '/contracts/contract-1/cancel',
    '/admin/contracts/contract-1/cancel',
    '/admin/contracts/contract-1/reject',
    '/admin/contracts/contract-1/review-cancellation/request-1',
    '/admin/contracts/contract-1/decline-cancellation/request-1',
  ]) {
    assert.equal(isRegisteredWebPath(path), true, path);
  }
});

test('rejects renamed prefixes, extra segments and empty route parameters', () => {
  for (const path of [
    '/savings/request/order-1',
    '/admin/order-dashboard',
    '/electricity/orders/order-1/summary',
    '/solar/requests//',
    '/admin/saving-orders/order-1/cancel-upgrade/upgrade-1/confirm',
  ]) {
    assert.equal(isRegisteredWebPath(path), false, path);
  }
});
