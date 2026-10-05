import { expect, it } from 'vitest';
import {
  staffPriceState,
  staffPriceReview,
  staffPriceReceipt,
  deepSorted,
} from '../test/electricity-price-staff-fixtures.js';
import {
  boundPriceReview,
  matchedPriceReceipt,
  parseStaffPriceState,
  priceCalculationDigest,
  definitivePriceRejection,
  definitiveMissingPrice,
} from './electricity-price-form.js';
import { priceProposalSchema, priceContractSchema } from './electricity-price-form-schemas.js';
import { ErrorCodes } from '@barghsa/shared/errors';

it('validates the picker and four proposal inputs while preserving raw companion values', () => {
  expect(priceContractSchema('contract').safeParse({ contractId: 'not a UUID' }).success).toBe(
    false
  );
  expect(
    priceContractSchema('contract').safeParse({ contractId: `  ${staffPriceState().contractId}  ` })
      .success
  ).toBe(true);
  const messages = {
    percentage: 'percentage',
    effectiveFrom: 'date',
    reason: 'reason',
    basis: 'basis',
  };
  const schema = priceProposalSchema(messages, 'Asia/Tehran');
  const raw = {
    percentage: '-2.50',
    effectiveFrom: '2026-10-06T12:00',
    reason: '  Valid reason  ',
    basis: '  Clause 7  ',
  };
  expect(schema.safeParse(raw)).toMatchObject({ success: true, data: raw });
  expect(schema.safeParse({ ...raw, effectiveFrom: '2026-02-30T12:00' }).success).toBe(false);
  expect(schema.safeParse({ ...raw, percentage: '-100' }).success).toBe(false);
  expect(schema.safeParse({ ...raw, reason: 'x'.repeat(1001) }).success).toBe(false);
  expect(schema.safeParse({ ...raw, basis: 'x'.repeat(2001) }).success).toBe(false);
});

it('decodes complete staff state and rejects missing grants or foreign rows', () => {
  const state = staffPriceState([staffPriceReceipt()]);
  expect(parseStaffPriceState(state, state.contractId)).not.toBeNull();
  expect(parseStaffPriceState({ ...state, canFinalize: undefined }, state.contractId)).toBeNull();
  expect(
    parseStaffPriceState(
      { ...state, adjustments: [{ ...state.adjustments[0], contractId: state.profileId }] },
      state.contractId
    )
  ).toBeNull();
  expect(
    parseStaffPriceState({ ...state, adjustments: [{ status: 'proposed' }] }, state.contractId)
  ).toBeNull();
});

it('binds the authoritative complete review to profile, version, period and exact proposal', () => {
  const state = staffPriceState();
  const review = staffPriceReview();
  const calculation = review.data.calculation;
  const proposal = {
    expectedVersionId: state.versionId,
    effectiveFrom: calculation.quote.effectiveFrom,
    percentageBps: calculation.quote.percentageBps,
    reason: calculation.reason,
    contractualBasis: calculation.contractualBasis,
  };
  expect(boundPriceReview(review, state, proposal)).not.toBeNull();
  expect(boundPriceReview(review, { ...state, profileId: state.contractId }, proposal)).toBeNull();
  expect(
    boundPriceReview(review, { ...state, periodEnd: '2027-01-01T00:00:00.000Z' }, proposal)
  ).toBeNull();
  for (const changed of [
    { expectedVersionId: state.contractId },
    { percentageBps: '2000' },
    { reason: 'Other' },
    { contractualBasis: 'Other' },
    { effectiveFrom: '2026-10-07T00:00:00.000Z' },
  ])
    expect(boundPriceReview(review, state, { ...proposal, ...changed })).toBeNull();
});

it('uses the actual service constructor-order digest after parsing a sorted financial preview', async () => {
  const state = staffPriceState();
  const original = staffPriceReview();
  const calculation = original.data.calculation;
  const proposal = {
    expectedVersionId: state.versionId,
    effectiveFrom: calculation.quote.effectiveFrom,
    percentageBps: calculation.quote.percentageBps,
    reason: calculation.reason,
    contractualBasis: calculation.contractualBasis,
  };
  const parsed = boundPriceReview(deepSorted(original), state, proposal)!;
  expect(await priceCalculationDigest(parsed.data.calculation)).toBe(
    staffPriceReceipt(original).calculationSha256
  );
  expect(await priceCalculationDigest(deepSorted(original).data.calculation)).not.toBe(
    staffPriceReceipt(original).calculationSha256
  );
});

it('accepts progressed publish replay and JSONB key ordering only with exact immutable calculation evidence', () => {
  const review = staffPriceReview();
  const row = staffPriceReceipt(review);
  const expected = {
    operation: 'publish' as const,
    contractId: row.contractId,
    periodEnd: row.periodEnd,
    calculation: review.data.calculation,
    calculationSha256: row.calculationSha256,
  };
  expect(
    matchedPriceReceipt(deepSorted(staffPriceReceipt(review, 'finalized')), expected)
  ).not.toBeNull();
  expect(matchedPriceReceipt(staffPriceReceipt(review, 'cancelled'), expected)).not.toBeNull();
  expect(matchedPriceReceipt({ status: 'done' }, expected)).toBeNull();
  expect(matchedPriceReceipt({ ...row, calculationSha256: 'a'.repeat(64) }, expected)).toBeNull();
  expect(
    matchedPriceReceipt(
      { ...row, calculation: { ...row.calculation, versionId: row.contractId } },
      expected
    )
  ).toBeNull();
});

it('requires finalize or cancel receipts to prove their own target and immutable proposal', () => {
  const review = staffPriceReview();
  const row = staffPriceReceipt(review);
  const expected = {
    contractId: row.contractId,
    adjustmentId: row.adjustmentId,
    periodEnd: row.periodEnd,
    calculation: row.calculation,
    calculationSha256: row.calculationSha256,
  };
  expect(
    matchedPriceReceipt(staffPriceReceipt(review, 'finalized'), {
      ...expected,
      operation: 'finalize',
    })
  ).not.toBeNull();
  expect(
    matchedPriceReceipt(staffPriceReceipt(review, 'cancelled'), {
      ...expected,
      operation: 'cancel',
    })
  ).not.toBeNull();
  expect(matchedPriceReceipt(row, { ...expected, operation: 'finalize' })).toBeNull();
  expect(
    matchedPriceReceipt(staffPriceReceipt(review, 'finalized'), {
      ...expected,
      operation: 'cancel',
    })
  ).toBeNull();
  expect(
    matchedPriceReceipt(
      { ...staffPriceReceipt(review, 'finalized'), adjustmentId: row.contractId },
      { ...expected, operation: 'finalize' }
    )
  ).toBeNull();
});

it('recognizes only complete public no-write and missing-resource rejections', () => {
  const error = {
    code: ErrorCodes.VALIDATION_INPUT_INVALID.code,
    message: 'Invalid',
    correlationId: '88888888-8888-4888-8888-888888888888',
  };
  expect(definitivePriceRejection({ error })).toBe(true);
  expect(definitivePriceRejection({ error: { ...error, code: 'VALIDATION:INPUT_INVALID' } })).toBe(
    true
  );
  expect(definitivePriceRejection({ error: { code: error.code, fields: ['reason'] } })).toBe(false);
  expect(
    definitiveMissingPrice({ error: { ...error, code: ErrorCodes.NOT_FOUND_RESOURCE.code } })
  ).toBe(true);
  expect(definitiveMissingPrice({ error: { code: ErrorCodes.NOT_FOUND_RESOURCE.code } })).toBe(
    false
  );
});
