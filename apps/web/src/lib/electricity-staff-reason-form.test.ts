import { expect, it } from 'vitest';
import { ErrorCodes } from '@barghsa/shared/errors';
import {
  boundStaffDecisionReview,
  confirmedStaffDecision,
  definitiveStaffDecisionRejection,
} from './electricity-staff-reason-form.js';
import { staffReasonSchema } from './electricity-staff-reason-form-schemas.js';

import { staffFormOrder, staffFormReview } from '../test/electricity-staff-reason-fixtures.js';

it('keeps the raw reason and validates its trimmed 1–1,000 boundary', () => {
  const schema = staffReasonSchema('Invalid reason');
  const raw = `  ${'x'.repeat(1000)}  `;
  expect(schema.safeParse({ reason: raw }).data).toEqual({ reason: raw });
  for (const reason of ['', ' \n ', 'x'.repeat(1001)]) {
    const result = schema.safeParse({ reason });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['reason']);
  }
});
it('binds a complete review to the captured action, resource, profile, version, reason and financial identities', () => {
  const value = staffFormReview();
  expect(
    boundStaffDecisionReview(value, staffFormOrder, 'request-changes', ' Correct the address ')
  ).not.toBeNull();
  for (const value of [
    { ...staffFormReview(), schemaVersion: 2 },
    {
      ...staffFormReview(),
      scope: { ...staffFormReview().scope, profileId: staffFormOrder.orderId },
    },
    {
      ...staffFormReview(),
      scope: { ...staffFormReview().scope, resourceId: staffFormOrder.profileId },
    },
    {
      ...staffFormReview(),
      data: { ...staffFormReview().data, versionId: staffFormOrder.orderId },
    },
    {
      ...staffFormReview(),
      data: { ...staffFormReview().data, contractId: staffFormOrder.orderId },
    },
    {
      ...staffFormReview(),
      data: { ...staffFormReview().data, invoiceId: staffFormOrder.orderId },
    },
    { ...staffFormReview(), data: { ...staffFormReview().data, commercialStatus: 'approved' } },
    staffFormReview('reject'),
    staffFormReview('request-changes', 'Another reason'),
  ])
    expect(
      boundStaffDecisionReview(value, staffFormOrder, 'request-changes', 'Correct the address')
    ).toBeNull();
});
it('approval remains reason-free and a reason-bearing review cannot confirm it', () => {
  expect(
    boundStaffDecisionReview(staffFormReview('approve'), staffFormOrder, 'approve', 'unused')
  ).not.toBeNull();
  const value = staffFormReview('approve');
  value.data.reason = 'unused';
  expect(boundStaffDecisionReview(value, staffFormOrder, 'approve', 'unused')).toBeNull();
});
it.each(['approve', 'request-changes', 'reject'] as const)(
  'requires the exact %s receipt without inventing a version field',
  (action) => {
    const review = boundStaffDecisionReview(
      staffFormReview(action),
      staffFormOrder,
      action,
      'Correct the address'
    )!;
    const value = {
      orderId: staffFormOrder.orderId,
      contractId: staffFormOrder.contractId,
      invoiceId: staffFormOrder.invoiceId,
      status:
        action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'changes_requested',
      refundId: null,
    };
    expect(confirmedStaffDecision(value, review)).toBe(true);
    for (const receipt of [
      null,
      {},
      { ...value, orderId: staffFormOrder.profileId },
      { ...value, contractId: staffFormOrder.profileId },
      { ...value, invoiceId: staffFormOrder.profileId },
      { ...value, status: 'awaiting_staff_review' },
      { ...value, refundId: staffFormOrder.orderId },
    ])
      expect(confirmedStaffDecision(receipt, review)).toBe(false);
  }
);
it('accepts a paid rejection only with an identified refund obligation', () => {
  const value = staffFormReview('reject');
  Object.assign(value.data, {
    paidAmount: '100',
    outcome: 'refund_obligation',
    refundAmount: '100',
  });
  const review = boundStaffDecisionReview(value, staffFormOrder, 'reject', 'Correct the address')!;
  const receipt = {
    orderId: staffFormOrder.orderId,
    contractId: staffFormOrder.contractId,
    invoiceId: staffFormOrder.invoiceId,
    status: 'rejected',
    refundId: staffFormOrder.profileId,
  };
  expect(confirmedStaffDecision(receipt, review)).toBe(true);
  expect(confirmedStaffDecision({ ...receipt, refundId: null }, review)).toBe(false);
});
it('only complete public no-write rejection envelopes unlock correction', () => {
  const error = {
    code: ErrorCodes.CONFLICT_STATE.code,
    message: 'Conflict',
    correlationId: staffFormOrder.orderId,
  };
  expect(definitiveStaffDecisionRejection({ error })).toBe(true);
  for (const value of [
    {},
    { error: 'Conflict' },
    { error: { code: error.code } },
    { error: { ...error, correlationId: 'bad' } },
    { error: { ...error, code: 'UNKNOWN' } },
  ])
    expect(definitiveStaffDecisionRejection(value)).toBe(false);
});
