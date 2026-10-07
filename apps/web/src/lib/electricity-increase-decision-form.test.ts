import { expect, it } from 'vitest';
import { parseElectricityIncreaseStaffDecisionReview } from '@barghsa/shared/finance';
import { increaseDecisionFixture } from '../test/electricity-increase-decision-fixtures.js';
import {
  boundIncreaseDecisionReview,
  confirmedIncreaseDecision,
  increaseEffectiveFrom,
} from './electricity-increase-decision-form.js';
import { increaseDecisionSchema } from './electricity-increase-decision-form-schemas.js';

it('resolves optional dates in the explicit account timezone without browser-local conversion', () => {
  expect(increaseEffectiveFrom('', 'Asia/Tehran')).toBeUndefined();
  expect(increaseEffectiveFrom('2026-10-01T12:00', 'Asia/Tehran')).toBe('2026-10-01T08:30:00.000Z');
  expect(increaseEffectiveFrom('2026-10-01T12:00', 'America/Los_Angeles')).toBe(
    '2026-10-01T19:00:00.000Z'
  );
  expect(increaseEffectiveFrom('2026-10-01T12:00:30.12', 'Asia/Tehran')).toBe(
    '2026-10-01T08:30:30.120Z'
  );
});
it.each([
  ['bad-date', 'Asia/Tehran'],
  ['2026-02-30T12:00', 'Asia/Tehran'],
  ['2026-03-08T02:30', 'America/New_York'],
  ['2026-10-01T24:00', 'Asia/Tehran'],
  ['2026-10-01T12:60', 'Asia/Tehran'],
  ['2026-10-01T12:00:60', 'Asia/Tehran'],
  ['2026-10-01T12:00', 'Invalid/Zone'],
  ['2026-10-01T12:00', null],
])('rejects invalid or unavailable account civil times: %s in %s', (raw, timezone) => {
  expect(increaseEffectiveFrom(raw, timezone)).toBeNull();
});

it('requires each decision reason and validates only approval dates', () => {
  expect(
    increaseDecisionSchema('approve', 'date', 'Asia/Tehran').safeParse({
      effectiveDate: '',
      reason: '',
    }).success
  ).toBe(false);
  expect(
    increaseDecisionSchema('approve', 'date', 'Asia/Tehran').safeParse({
      effectiveDate: 'invalid',
      reason: 'Valid reason',
    }).success
  ).toBe(false);
  expect(
    increaseDecisionSchema('reject', 'reason', null).safeParse({
      effectiveDate: 'invalid',
      reason: 'Valid reason',
    }).success
  ).toBe(true);
  expect(
    increaseDecisionSchema('reject', 'reason', null).safeParse({
      effectiveDate: '',
      reason: ' '.repeat(5),
    }).success
  ).toBe(false);
  expect(
    increaseDecisionSchema('reject', 'reason', null).safeParse({
      effectiveDate: '',
      reason: 'x'.repeat(1001),
    }).success
  ).toBe(false);
});

it('binds complete staff financial reviews to the request and selected decision', () => {
  const { request, decisionReview } = increaseDecisionFixture();
  expect(
    boundIncreaseDecisionReview(decisionReview('approve'), request, 'approve', {
      reason: 'Capacity reviewed',
    })
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
        { reason: 'Capacity reviewed' }
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
  const review = boundIncreaseDecisionReview(decisionReview('approve'), request, 'approve', {
    reason: 'Capacity reviewed',
  })!;
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
  const review = boundIncreaseDecisionReview(decisionReview('approve'), request, 'approve', {
    reason: 'Capacity reviewed',
  })!;
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

it('reads legacy approvals without allowing their blank reason to bind a new decision', async () => {
  const { request, decisionReview, receipt } = increaseDecisionFixture();
  const legacy = parseElectricityIncreaseStaffDecisionReview(decisionReview('approve', ''))!;
  expect(boundIncreaseDecisionReview(legacy, request, 'approve', { reason: '' })).toBeNull();
  expect(await confirmedIncreaseDecision(await receipt('approve', ''), legacy)).toBe(true);
  const review = parseElectricityIncreaseStaffDecisionReview(decisionReview('approve'))!;
  const row = await receipt('approve');
  expect(await confirmedIncreaseDecision({ ...row, reviewReason: 'Changed reason' }, review)).toBe(
    false
  );
  expect(
    await confirmedIncreaseDecision(
      { ...row, amendmentDocument: { ...row.amendmentDocument, approvalReason: 'Changed reason' } },
      review
    )
  ).toBe(false);
});

it('parses legacy empty and new approval reasons while rejecting blank and oversized reasons', () => {
  const { decisionReview } = increaseDecisionFixture();
  for (const reason of ['', 'Capacity reviewed'])
    expect(
      parseElectricityIncreaseStaffDecisionReview(decisionReview('approve', reason))
    ).not.toBeNull();
  for (const reason of ['   ', 'x'.repeat(1001)])
    expect(
      parseElectricityIncreaseStaffDecisionReview(decisionReview('approve', reason))
    ).toBeNull();
});
