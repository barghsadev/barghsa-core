import { expect, it } from 'vitest';
import {
  bindSavingChangeQuote,
  matchedSavingChangeReceipt,
  parseSavingChangeQuote,
  savingChangeOptions,
  definitiveSavingChangeRejection,
} from './saving-change-form.js';
import { savingChangeSchema } from './saving-change-form-schemas.js';

import {
  ids,
  source,
  draft,
  address,
  plans,
  addresses,
  fullQuote,
  receipt,
} from './saving-change-form.fixtures.js';

it('parses full actual quote and binds current plan, source, selections and complete address', () => {
  expect(bindSavingChangeQuote(fullQuote(), source, draft, address)).toEqual(fullQuote());
  for (const [name, value] of Object.entries({
    planId: ids.hardware,
    currentVersionId: ids.newVersion,
    billIdentifier: '654321',
    agreementVersionId: ids.city,
  }))
    expect(
      bindSavingChangeQuote(fullQuote(), { ...source, [name]: value }, draft, address)
    ).toBeNull();
  expect(
    bindSavingChangeQuote(fullQuote(), source, draft, { ...address, fullAddress: 'Edited' })
  ).toBeNull();
});
it('rejects partial, malformed, inconsistent totals/lines and invalid exact discount allocation', () => {
  const quote = fullQuote();
  for (const value of [
    { reviewDigest: quote.reviewDigest, totalIrR: quote.totalIrR },
    { ...quote, reviewDigest: 'A'.repeat(64) },
    { ...quote, totalIrR: '378326' },
    { ...quote, lines: [{ ...quote.lines[0], netIrR: '92501' }, quote.lines[1]] },
    { ...quote, lines: [quote.lines[1], quote.lines[0]] },
    { ...quote, giftCodeId: undefined },
    { ...quote, lines: [{ ...quote.lines[0], vatRateBps: '0' }, quote.lines[1]] },
  ])
    expect(parseSavingChangeQuote(value)).toBeNull();
});
it('keeps whole-IRR large integer precision, largest-remainder ties and half-up VAT', () => {
  const quote = fullQuote();
  quote.lines = quote.lines.map((line) => ({
    ...line,
    amountIrR: '1',
    discountIrR: line.type === 'plan_price' ? '1' : '0',
    netIrR: line.type === 'plan_price' ? '0' : '1',
    vatRateBps: 5000,
    vatIrR: line.type === 'plan_price' ? '0' : '1',
  }));
  Object.assign(quote, { subtotalIrR: '2', discountIrR: '1', vatIrR: '1', totalIrR: '2' });
  expect(parseSavingChangeQuote(quote)).not.toBeNull();
  const big = fullQuote();
  big.lines = big.lines.map((line) => ({
    ...line,
    amountIrR: '4500000000000000000',
    discountIrR: '0',
    netIrR: '4500000000000000000',
    vatRateBps: 0,
    vatIrR: '0',
  }));
  Object.assign(big, {
    subtotalIrR: '9000000000000000000',
    discountIrR: '0',
    vatIrR: '0',
    totalIrR: '9000000000000000000',
  });
  expect(parseSavingChangeQuote(big)).not.toBeNull();
});
it('requires matching full201 saved revision with new version and same source invoice, independent of JSONB object key order', () => {
  const saved = receipt();
  const reordered = JSON.parse(
    JSON.stringify(saved, (key, value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse())
        : value
    )
  );
  expect(matchedSavingChangeReceipt(reordered, source, fullQuote())).toEqual(fullQuote());
  for (const value of [
    { ...saved, invoiceId: ids.city },
    { ...saved, contractVersionId: ids.version },
    { ...saved, savingOrderId: ids.profileId },
    { ...saved, agreement: { ...saved.agreement, body: 'Changed' } },
    { ...saved, reviewDigest: 'b'.repeat(64) },
  ])
    expect(matchedSavingChangeReceipt(value, source, fullQuote())).toBeNull();
});
it('validates offered selections, unavailable hardware and unchanged pair without losing the raw draft', () => {
  const options = savingChangeOptions(plans, addresses, ids.planId, ids.profileId)!;
  expect(options).not.toBeNull();
  expect(
    savingChangeOptions(
      plans,
      { addresses: [{ ...address, profileId: ids.city }] },
      ids.planId,
      ids.profileId
    )
  ).toBeNull();
  const schema = savingChangeSchema(
    options.hardware,
    options.addresses,
    { hardwareProductId: ids.hardware, installationAddressId: ids.address },
    { hardwareProductId: 'hardware', installationAddressId: 'address', unchanged: 'change' }
  );
  expect(schema.safeParse(draft).success).toBe(true);
  expect(schema.safeParse({ ...draft, hardwareProductId: ids.emptyHardware }).success).toBe(false);
  expect(schema.safeParse({ ...draft, installationAddressId: ids.city }).success).toBe(false);
  expect(
    schema.safeParse({ hardwareProductId: ids.hardware, installationAddressId: ids.address })
      .success
  ).toBe(false);
  expect(
    savingChangeOptions(
      plans,
      { addresses: [{ ...address, provinceId: 'bad' }] },
      ids.planId,
      ids.profileId
    )
  ).toBeNull();
});
it('recognizes only complete known public rejection envelopes before any original command release', () => {
  for (const code of [
    'VALIDATION:INPUT:INVALID',
    'VALIDATION:INPUT_INVALID',
    'CONFLICT:INVALID_STATE',
  ])
    expect(
      definitiveSavingChangeRejection({
        error: { code, message: 'Invalid', correlationId: ids.orderId },
      })
    ).not.toBeNull();
  for (const error of [
    { code: 'UNKNOWN', message: 'Invalid', correlationId: ids.orderId },
    { code: 'VALIDATION:INPUT:INVALID', fields: ['hardwareProductId'] },
    { code: 'VALIDATION:INPUT:INVALID', message: 'Invalid', correlationId: 'notUUID' },
  ])
    expect(definitiveSavingChangeRejection({ error })).toBeNull();
});
