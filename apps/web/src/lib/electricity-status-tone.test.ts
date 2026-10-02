import { expect, it } from 'vitest';
import { t } from '@barghsa/i18n/app';
import {
  commercialStatusTone,
  financialStatusTone,
  electricityStatusKey,
} from './electricity-status-tone.js';

for (const locale of ['fa', 'en'] as const) {
  it.each([
    'draft',
    'submitted',
    'awaiting_staff_review',
    'changes_requested',
    'approved',
    'active',
    'completed',
    'rejected',
    'cancelled',
  ])('localizes commercial %s in ' + locale, (status) => {
    const key = electricityStatusKey(status, 'commercial');
    expect(t(key, locale)).not.toBe(key);
    if (locale === 'fa') expect(t(key, locale)).toMatch(/[\u0600-\u06ff]/);
  });
  it.each([
    'unpaid',
    'payment_under_review',
    'partially_funded',
    'paid',
    'refund_pending',
    'partially_refunded',
    'refunded',
  ])('localizes financial %s in ' + locale, (status) => {
    const key = electricityStatusKey(status, 'financial');
    expect(t(key, locale)).not.toBe(key);
    if (locale === 'fa') expect(t(key, locale)).toMatch(/[\u0600-\u06ff]/);
  });
}
it.each([
  'future_paid_state',
  'pending_private_future',
  '__proto__',
  'constructor',
  'toString',
  'Paid',
])('keeps unknown or cross-domain %s neutral without exposing it', (status) => {
  expect(commercialStatusTone(status)).toBe('default');
  expect(electricityStatusKey(status, 'commercial')).toBe('electricity.order.status.unknown');
  if (status !== 'Paid') {
    expect(financialStatusTone(status)).toBe('default');
    expect(electricityStatusKey(status, 'financial')).toBe('electricity.order.status.unknown');
  }
});
it('keeps lifecycle and payment colors independent', () => {
  expect(commercialStatusTone('active')).toBe('success');
  expect(financialStatusTone('unpaid')).toBe('warning');
  expect(commercialStatusTone('completed')).toBe('default');
  expect(financialStatusTone('paid')).toBe('success');
  expect(financialStatusTone('partially_funded')).toBe('warning');
  expect(commercialStatusTone('cancelled')).toBe('destructive');
  expect(financialStatusTone('refund_pending')).toBe('warning');
});
