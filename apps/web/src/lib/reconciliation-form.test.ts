import { expect, it } from 'vitest';
import {
  reconciliationItem,
  paymentProfileId,
  paymentInvoiceId,
} from '../test/payment-review-fixtures.js';
import {
  reconciliationBounds,
  reconciliationFilterErrors,
  reconciliationNoteErrors,
  reconciliationAllowed,
  matchesReconciliationReceipt,
  reconciliationLinks,
} from './reconciliation-form.js';
const zone = 'America/Los_Angeles';
it('preserves untouched precise UTC bounds and rejects DST gaps and inverted ranges', () => {
  const value = {
    status: 'open',
    severity: 'high',
    from: '2026-09-01T00:00',
    before: '2026-09-02T00:00',
  };
  const applied = { createdFrom: '2026-09-01T07:00:15.123Z' };
  expect(reconciliationBounds(value, zone, applied).from?.toISOString()).toBe(applied.createdFrom);
  expect(reconciliationFilterErrors(value, zone, applied)).toEqual([]);
  expect(
    reconciliationFilterErrors({ ...value, from: '2026-03-08T02:30', before: '' }, zone)
  ).toEqual(['from']);
  expect(reconciliationFilterErrors({ ...value, before: '2026-08-01T00:00' }, zone)).toEqual([
    'before',
  ]);
  expect(reconciliationFilterErrors({ ...value, status: 'bad', severity: 'bad' }, zone)).toEqual([
    'status',
    'severity',
  ]);
});
it('validates explanations without changing raw whitespace and fences allowed actions', () => {
  for (const note of [' ', 'x'.repeat(1001)])
    expect(reconciliationNoteErrors({ note })).toEqual(['note']);
  const raw = '  Checked ledger  ';
  expect(reconciliationNoteErrors({ note: raw })).toEqual([]);
  expect(raw).toBe('  Checked ledger  ');
  expect(reconciliationAllowed('resolved', 'close')).toBe(true);
  for (const verb of ['investigate', 'resolve', 'close'] as const)
    expect(reconciliationAllowed('closed', verb)).toBe(false);
  expect(reconciliationAllowed('resolved', 'resolve')).toBe(false);
});
it('matches actual lifecycle receipts including preserved resolution during closure', () => {
  expect(
    matchesReconciliationReceipt(
      { ...reconciliationItem, status: 'resolved', resolutionNote: 'Checked ledger' },
      reconciliationItem,
      'resolve',
      ' Checked ledger '
    )
  ).toBe(true);
  const resolved = {
    ...reconciliationItem,
    status: 'resolved',
    resolutionNote: 'Original resolution',
  };
  expect(
    matchesReconciliationReceipt(
      { ...resolved, status: 'closed' },
      resolved,
      'close',
      'Closure explanation'
    )
  ).toBe(true);
  expect(
    matchesReconciliationReceipt(
      { ...resolved, status: 'closed', resolutionNote: 'Closure explanation' },
      resolved,
      'close',
      'Closure explanation'
    )
  ).toBe(false);
  for (const value of [
    {},
    { ...resolved, id: paymentInvoiceId },
    { ...resolved, status: 'open' },
    { ...resolved, resolutionNote: 'Other' },
  ])
    expect(
      matchesReconciliationReceipt(value, reconciliationItem, 'resolve', 'Original resolution')
    ).toBe(false);
});
it('links only validated IDs to the actual profile and invoice routes', () => {
  expect(
    reconciliationLinks({ walletId: ` ${paymentProfileId} `, invoiceId: paymentInvoiceId })
  ).toEqual([
    { label: 'walletLink', href: `/admin/crm/profiles/${paymentProfileId}` },
    { label: 'invoiceLink', href: `/invoices/${paymentInvoiceId}` },
  ]);
  expect(
    reconciliationLinks({ walletId: 'javascript:alert(1)', invoiceId: '../../login' })
  ).toEqual([]);
});
