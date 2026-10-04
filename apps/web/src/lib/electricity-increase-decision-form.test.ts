import { expect, it } from 'vitest';
import { increaseDecisionFixture } from '../test/electricity-increase-decision-fixtures.js';
import {
  boundIncreaseDecisionReview,
  confirmedIncreaseDecision,
  increaseEffectiveFrom,
} from './electricity-increase-decision-form.js';
import { increaseDecisionSchema } from './electricity-increase-decision-form-schemas.js';

it('validates optional local dates before conversion and rejects calendar rollover', () => {
  expect(increaseEffectiveFrom('')).toBeUndefined();
  expect(increaseEffectiveFrom('bad-date')).toBeNull();
  expect(increaseEffectiveFrom('2026-02-30T12:00')).toBeNull();
  expect(increaseEffectiveFrom('2026-10-01T12:00')).toBe(
    new Date('2026-10-01T12:00').toISOString()
  );
});

it('validates only the field owned by each independent decision', () => {
  expect(
    increaseDecisionSchema('approve', 'date').safeParse({ effectiveDate: '', reason: '' }).success
  ).toBe(true);
  expect(
    increaseDecisionSchema('approve', 'date').safeParse({
      effectiveDate: 'invalid',
      reason: 'Valid reason',
    }).success
  ).toBe(false);
  expect(
    increaseDecisionSchema('reject', 'reason').safeParse({
      effectiveDate: 'invalid',
      reason: 'Valid reason',
    }).success
  ).toBe(true);
  expect(
    increaseDecisionSchema('reject', 'reason').safeParse({
      effectiveDate: '',
      reason: ' '.repeat(5),
    }).success
  ).toBe(false);
  expect(
    increaseDecisionSchema('reject', 'reason').safeParse({
      effectiveDate: '',
      reason: 'x'.repeat(1001),
    }).success
  ).toBe(false);
});

it('binds complete staff financial reviews to the request and selected decision', () => {
  const { request, decisionReview } = increaseDecisionFixture();
  expect(
    boundIncreaseDecisionReview(decisionReview('approve'), request, 'approve', {})
  ).not.toBeNull();
  expect(
    boundIncreaseDecisionReview(decisionReview('reject'), request, 'reject', {
      reason: 'Outside capacity plan',
    })
  ).not.toBeNull();
  for (const data of [
    { profileId: request.contractId },
    { orderId: request.contractId },
    { versionId: request.contractId },
    { requestedKwh: '13' },
    { maxPercentageAtRequest: 30 },
    { requestedEffectiveFrom: request.periodEnd },
    { reason: 'other' },
  ]) {
    const review = decisionReview('approve');
    expect(
      boundIncreaseDecisionReview(
        { ...review, data: { ...review.data, ...data } },
        request,
        'approve',
        {}
      )
    ).toBeNull();
  }
});

it('confirms actual decision rows and rejects malformed or unrelated write receipts', async () => {
  const { request, decisionReview, receipt } = increaseDecisionFixture();
  const review = boundIncreaseDecisionReview(decisionReview('reject'), request, 'reject', {
    reason: 'Outside capacity plan',
  })!;
  const row = await receipt('reject');
  expect(await confirmedIncreaseDecision(row, review)).toBe(true);
  expect(await confirmedIncreaseDecision({ status: 'done' }, review)).toBe(false);
  expect(await confirmedIncreaseDecision({ ...row, versionId: request.contractId }, review)).toBe(
    false
  );
  expect(await confirmedIncreaseDecision({ ...row, reviewReason: 'other' }, review)).toBe(false);
});

it('checks immutable approval evidence and its digest independently of JSONB key order', async () => {
  const { request, decisionReview, receipt } = increaseDecisionFixture();
  const review = boundIncreaseDecisionReview(decisionReview('approve'), request, 'approve', {})!;
  const row = await receipt('approve');
  expect(
    await confirmedIncreaseDecision(
      {
        ...row,
        amendmentDocument: Object.fromEntries(Object.entries(row.amendmentDocument!).reverse()),
      },
      review
    )
  ).toBe(true);
  expect(await confirmedIncreaseDecision({ ...row, amendmentSha256: 'f'.repeat(64) }, review)).toBe(
    false
  );
  expect(
    await confirmedIncreaseDecision(
      { ...row, amendmentDocument: { ...row.amendmentDocument, requestedKwh: '13' } },
      review
    )
  ).toBe(false);
});

it('accepts a later live approval replay only with the same amendment and valid signing evidence', async () => {
  const { request, decisionReview, receipt } = increaseDecisionFixture();
  const review = boundIncreaseDecisionReview(decisionReview('approve'), request, 'approve', {})!;
  const row = await receipt('approve');
  const signedAt = '2026-10-01T00:00:00.000Z';
  const later = {
    ...row,
    status: 'awaiting_effective_date',
    signedAt,
    signatureEvidence: {
      schemaVersion: 1,
      amendmentSha256: row.amendmentSha256,
      signedBy: 'customer-1',
      sessionId: 'session-1',
      signedAt,
      adjustmentIrR: '1000',
    },
    pricingSnapshot: {},
    adjustmentAmount: '1000',
    adjustmentInvoiceId: '77777777-7777-7777-8777-777777777777',
  };
  expect(await confirmedIncreaseDecision(later, review)).toBe(true);
  expect(
    await confirmedIncreaseDecision(
      {
        ...later,
        signatureEvidence: { ...later.signatureEvidence, amendmentSha256: 'f'.repeat(64) },
      },
      review
    )
  ).toBe(false);
});
