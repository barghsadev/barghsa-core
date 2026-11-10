import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isRegisteredWebPath } from './web-navigation-paths.mjs';

test('matches concrete destinations under registered customer and staff routes', () => {
  for (const path of [
    '/',
    '/savings/',
    '/electricity/orders/order-1',
    '/savings/orders/order-1',
    '/solar/requests/request-1',
    '/consultations/request-1',
    '/invoices/invoice-1',
    '/admin/wallet-ledger/profile-1',
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
  ]) {
    assert.equal(isRegisteredWebPath(path), false, path);
  }
});
