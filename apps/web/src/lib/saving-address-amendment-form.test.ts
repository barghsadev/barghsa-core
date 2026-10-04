import { expect, it } from 'vitest';
import { parseSavingAddressAmendmentReview } from '@barghsa/shared/finance';
import { ErrorCodes } from '@barghsa/shared/errors';
import { savingAddressSchema } from './saving-address-amendment-form-schemas.js';
import {
  matchedSavingAddressReceipt,
  definitiveSavingAddressRejection,
  publicSavingAddressError,
} from './saving-address-amendment-form.js';
import {
  savingPreviousAddressId,
  savingReplacementAddress,
  staffSavingAddressReview,
  staffSavingAddressReceipt,
} from '../test/saving-address-amendment-fixtures.js';
it('validates offered replacement and trimmed1..1000 reason while preserving raw values', () => {
  const schema = savingAddressSchema(
    savingPreviousAddressId,
    [savingPreviousAddressId, savingReplacementAddress.id],
    { addressId: 'Address', reason: 'Reason' }
  );
  const valid = { addressId: savingReplacementAddress.id, reason: `  ${'x'.repeat(1000)}  ` };
  expect(schema.parse(valid)).toEqual(valid);
  for (const changed of [
    { ...valid, reason: 'x'.repeat(1001) },
    { ...valid, reason: '  ' },
    { ...valid, addressId: savingPreviousAddressId },
    { ...valid, addressId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
    { ...valid, addressId: 'bad' },
  ])
    expect(schema.safeParse(changed).success).toBe(false);
});
it('requires actual full replacement receipt and compares address fields independent of JSON object order', () => {
  const review = parseSavingAddressAmendmentReview(staffSavingAddressReview())!;
  const value = staffSavingAddressReceipt();
  expect(
    matchedSavingAddressReceipt(
      { ...value, address: Object.fromEntries(Object.entries(value.address).reverse()) },
      review
    )
  ).not.toBeNull();
  for (const changed of [
    { amendmentId: value.amendmentId },
    { ...value, savingOrderId: savingPreviousAddressId },
    { ...value, amendmentId: 'bad' },
    { ...value, address: { ...value.address, postal_code: '1111111111' } },
    { ...value, address: { ...value.address, city_id: savingPreviousAddressId } },
  ])
    expect(matchedSavingAddressReceipt(changed, review)).toBeNull();
});
it('recognizes only complete known rejection envelopes and complete missing-resource evidence', () => {
  const error = {
    code: ErrorCodes.VALIDATION_INPUT_INVALID.code,
    message: 'Invalid',
    correlationId: savingPreviousAddressId,
    fields: ['reason'],
  };
  expect(definitiveSavingAddressRejection({ error })).toEqual(error);
  expect(
    definitiveSavingAddressRejection({ error: { code: error.code, fields: error.fields } })
  ).toBeNull();
  expect(definitiveSavingAddressRejection({ error: { ...error, code: 'UNKNOWN' } })).toBeNull();
  expect(
    publicSavingAddressError({ error: { ...error, code: ErrorCodes.NOT_FOUND_RESOURCE.code } })
      ?.code
  ).toBe(ErrorCodes.NOT_FOUND_RESOURCE.code);
});
