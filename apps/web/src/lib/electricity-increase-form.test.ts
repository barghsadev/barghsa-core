import { expect, it } from 'vitest';
import { ErrorCodes } from '@barghsa/shared/errors';
import {
  boundIncreaseSigningReview,
  confirmedIncreaseRequest,
  confirmedIncreaseSignature,
  definitiveIncreaseRejection,
  increaseRow,
  increaseState,
  maximumIncreaseQuantity,
} from './electricity-increase-form.js';
import { electricityIncreaseSchema } from './electricity-increase-form-schemas.js';
import {
  contractId,
  versionId,
  profileId,
  invoiceId,
  eligibleFrom,
  periodEnd,
  eligibleState,
  requestRow,
  signatureRow,
  signingState,
  signingReview,
} from '../pages/electricity-increase-fixtures.js';

it('preserves exact percentage arithmetic and clamps the signed bigint limit', () => {
  expect(maximumIncreaseQuantity('101', 20)).toBe('121');
  expect(maximumIncreaseQuantity('9007199254740993', 1)).toBe('9097271247288402');
  expect(maximumIncreaseQuantity('9223372036854775800', 20)).toBe('9223372036854775807');
});
it('accepts a 19-digit quantity with raw surrounding space intact', () => {
  const schema = electricityIncreaseSchema(
    { format: 'format', range: 'range' },
    '9000000000000000000',
    '9223372036854775807'
  );
  const draft = { requestedKwh: ' 9223372036854775807 ' };
  expect(schema.safeParse(draft)).toEqual({ success: true, data: draft });
});
it.each(['', '0', '0120', '1.2', '-120', '10000000000000000000'])(
  'rejects the actual wire-invalid quantity %s on its owned field',
  (raw) => {
    const result = electricityIncreaseSchema(
      { format: 'format', range: 'range' },
      '100',
      '120'
    ).safeParse({ requestedKwh: raw });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues).toEqual([
        expect.objectContaining({ path: ['requestedKwh'], message: 'format' }),
      ]);
  }
);
it.each(['100', '99', '121'])('uses the policy range message for whole quantity %s', (raw) => {
  const result = electricityIncreaseSchema(
    { format: 'format', range: 'range' },
    '100',
    '120'
  ).safeParse({ requestedKwh: raw });
  expect(result.success).toBe(false);
  if (!result.success) expect(result.error.issues[0]?.message).toBe('range');
});
it('requires the actual complete persisted row and complete read envelope', () => {
  expect(increaseRow(requestRow())).toBe(true);
  const incomplete = { ...requestRow() } as Record<string, unknown>;
  delete incomplete.signatureEvidence;
  expect(increaseRow(incomplete)).toBe(false);
  expect(increaseRow(requestRow({ status: 'awaiting_payment' }))).toBe(false);
  expect(increaseState(eligibleState())).toBe(true);
  const omitted = { ...eligibleState() } as Record<string, unknown>;
  delete omitted.review;
  expect(increaseState(omitted)).toBe(false);
  expect(increaseState({ ...eligibleState(), request: requestRow() })).toBe(false);
});
it('proves the captured request against current identity even when replay has progressed', () => {
  const captured = {
    contractId,
    versionId,
    profileId,
    actor: 'customer',
    originalKwh: '100',
    requestedKwh: '120',
  };
  expect(confirmedIncreaseRequest(requestRow(), captured)).toBe(true);
  expect(confirmedIncreaseRequest(signingState().request, captured)).toBe(true);
  expect(
    confirmedIncreaseRequest(requestRow({ status: 'expired', expiredAt: periodEnd }), captured)
  ).toBe(true);
  expect(confirmedIncreaseRequest(requestRow({ status: 'expired' }), captured)).toBe(false);
  expect(
    confirmedIncreaseRequest(
      requestRow({
        status: 'rejected',
        reviewedAt: eligibleFrom,
        reviewedBy: 'staff',
        reviewReason: 'reason',
      }),
      captured
    )
  ).toBe(true);
  for (const delta of [
    { requestedKwh: '119' },
    { requestedBy: 'another-customer' },
    { profileId: invoiceId },
    { versionId: invoiceId },
    { contractId: invoiceId },
  ])
    expect(confirmedIncreaseRequest(requestRow(delta), captured)).toBe(false);
});
it('binds the priced signing review to contract, profile, version and immutable amendment', () => {
  expect(boundIncreaseSigningReview(signingState(), contractId, versionId, profileId)?.hash).toBe(
    'b'.repeat(64)
  );
  expect(boundIncreaseSigningReview(signingState(), contractId, invoiceId, profileId)).toBeNull();
  expect(boundIncreaseSigningReview(signingState(), contractId, versionId, invoiceId)).toBeNull();
  expect(
    boundIncreaseSigningReview(
      { ...signingState(), quote: { adjustmentIrR: '200001', eligibleFrom } },
      contractId,
      versionId,
      profileId
    )
  ).toBeNull();
});
it('accepts paid, effective and expired signature replays with the captured full financial proof', () => {
  const captured = signingState().request;
  const review = signingReview();
  for (const status of ['awaiting_payment', 'awaiting_effective_date', 'effective', 'expired']) {
    const row = signatureRow({
      status,
      effectiveAt: status === 'effective' ? eligibleFrom : null,
      expiredAt: status === 'expired' ? periodEnd : null,
    });
    expect(confirmedIncreaseSignature(row, captured, review, 'customer')).toBe(true);
  }
  expect(confirmedIncreaseSignature(signatureRow(), captured, review, 'another-customer')).toBe(
    false
  );
  expect(
    confirmedIncreaseSignature(signatureRow({ status: 'effective' }), captured, review, 'customer')
  ).toBe(false);
  const changedApproval = signatureRow();
  changedApproval.amendmentDocument = {
    ...changedApproval.amendmentDocument!,
    approvedBy: 'another-staff-member',
  };
  expect(confirmedIncreaseSignature(changedApproval, captured, review, 'customer')).toBe(false);
  const malformed = signatureRow();
  malformed.pricingSnapshot = { ...malformed.pricingSnapshot, originalInvoiceId: versionId };
  expect(confirmedIncreaseSignature(malformed, captured, review, 'customer')).toBe(false);
  const wrongEvidence = signatureRow();
  wrongEvidence.signatureEvidence = { ...wrongEvidence.signatureEvidence, adjustmentIrR: '200001' };
  expect(confirmedIncreaseSignature(wrongEvidence, captured, review, 'customer')).toBe(false);
});
it('compares durable JSONB financial components by values rather than key order', () => {
  const review = signingReview();
  review.data.priceAdjustments = [
    { invoiceId, amountIrR: '100000', effectiveFrom: eligibleFrom, increaseShareIrR: '10000' },
  ];
  review.data.baseShareIrR = '190000';
  const row = signatureRow();
  row.pricingSnapshot = {
    ...row.pricingSnapshot,
    priceAdjustments: [
      { increaseShareIrR: '10000', effectiveFrom: eligibleFrom, amountIrR: '100000', invoiceId },
    ],
    financialReview: {
      ...review,
      data: {
        ...review.data,
        priceAdjustments: [
          {
            increaseShareIrR: '10000',
            effectiveFrom: eligibleFrom,
            amountIrR: '100000',
            invoiceId,
          },
        ],
      },
    },
  };
  expect(confirmedIncreaseSignature(row, signingState().request, review, 'customer')).toBe(true);
  const mismatch = {
    ...row,
    pricingSnapshot: {
      ...row.pricingSnapshot,
      priceAdjustments: [
        { increaseShareIrR: '10001', effectiveFrom: eligibleFrom, amountIrR: '100000', invoiceId },
      ],
    },
  };
  expect(confirmedIncreaseSignature(mismatch, signingState().request, review, 'customer')).toBe(
    false
  );
});
it('only treats a recognized complete public envelope as a definitive rejection', () => {
  const rejected = {
    error: {
      code: ErrorCodes.VALIDATION_INPUT_INVALID.code,
      message: 'Rejected',
      correlationId: invoiceId,
      fields: ['requestedKwh'],
    },
  };
  expect(definitiveIncreaseRejection(rejected)).toBe(true);
  expect(
    definitiveIncreaseRejection(
      { error: { ...rejected.error, code: 'VALIDATION:INPUT_INVALID' } },
      400
    )
  ).toBe(true);
  expect(
    definitiveIncreaseRejection(
      { error: { ...rejected.error, code: 'VALIDATION:INPUT_INVALID' } },
      409
    )
  ).toBe(false);
  for (const delta of [{ code: 'UNRECOGNIZED' }, { message: '' }, { correlationId: 'not-an-id' }])
    expect(definitiveIncreaseRejection({ error: { ...rejected.error, ...delta } })).toBe(false);
  expect(
    definitiveIncreaseRejection({ error: { code: ErrorCodes.VALIDATION_INPUT_INVALID.code } })
  ).toBe(false);
});
