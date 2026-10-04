import { expect, it } from 'vitest';
import {
  electricityCorrectionReceipt,
  electricityRevisionQuote,
  definitiveElectricityRejection,
} from './electricity-correction-form.js';
import { ErrorCodes } from '@barghsa/shared/errors';
import {
  electricityAddressSchema,
  electricityRevisionSchema,
} from './electricity-correction-form-schemas.js';
import { formatJalaliDateTime } from './jalali-date-time.js';

const id = (digit: string) =>
  `${digit.repeat(8)}-${digit.repeat(4)}-7${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const quote = {
  reviewDigest: 'a'.repeat(64),
  periodStart: '2026-10-04T00:00:00Z',
  periodEnd: '2026-10-11T00:00:00Z',
  durationHours: '168',
  averagePowerKw: '0.05952381',
  greenRuleApplies: false,
  totalKwh: '10',
  subtotalIrR: '100',
  discountIrR: '0',
  vatIrR: '0',
  totalIrR: '100',
  lines: [
    {
      productId: id('8'),
      systemKey: 'thermal',
      quantityKwh: '10',
      unitPriceIrR: '10',
      subtotalIrR: '100',
      discountIrR: '0',
      vatRateBasisPoints: 0,
      vatIrR: '0',
      totalIrR: '100',
    },
  ],
};
const draft = {
  fullAddress: ' Saved address ',
  postalCode: '1234567890',
  responseNote: ' Corrected ',
  giftCode: '',
  provinceId: id('6'),
  cityId: id('7'),
  period: 'next_week',
  totalKwh: '10',
  startAt: formatJalaliDateTime(new Date(quote.periodStart)),
  endAt: formatJalaliDateTime(new Date(quote.periodEnd)),
  thermal: '10',
  green: '0',
  freeMarket: '0',
  energySaving: '0',
};
const messages = Object.fromEntries(
  Object.keys(draft).map((name) => [name, `Invalid ${name}`])
) as Record<keyof typeof draft, string>;
const options = {
  advanced: false,
  mandatoryGreen: false,
  periods: ['next_week'],
  locationValid: true,
};
it('accepts the actual complete quote with decimal-string duration and rejects partial or numeric receipts', () => {
  expect(electricityRevisionQuote(quote)).toBe(true);
  expect(electricityRevisionQuote({ ...quote, durationHours: 168 })).toBe(false);
  expect(electricityRevisionQuote({ ...quote, lines: [] })).toBe(false);
  expect(electricityRevisionQuote({ ...quote, totalIrR: '101' })).toBe(false);
  expect(
    electricityRevisionQuote({ ...quote, lines: [{ ...quote.lines[0], totalIrR: '-1' }] })
  ).toBe(false);
});
it('accepts only a new version bound to the same order and contract', () => {
  const captured = { orderId: id('1'), contractId: id('3'), versionId: id('4') };
  const receipt = { ...captured, versionId: id('9'), status: 'awaiting_staff_review' };
  expect(electricityCorrectionReceipt(receipt, captured)).toBe(true);
  expect(
    electricityCorrectionReceipt({ ...receipt, versionId: captured.versionId }, captured)
  ).toBe(false);
  expect(electricityCorrectionReceipt({ ...receipt, contractId: id('2') }, captured)).toBe(false);
  expect(electricityCorrectionReceipt({ status: receipt.status }, captured)).toBe(false);
});
it('requires replacement invoice and complete captured quote equality for a revision receipt', () => {
  const captured = {
    orderId: id('1'),
    contractId: id('3'),
    versionId: id('4'),
    invoiceId: id('5'),
  };
  const receipt = {
    ...captured,
    versionId: id('9'),
    invoiceId: id('2'),
    status: 'awaiting_staff_review',
    ...quote,
  };
  expect(electricityCorrectionReceipt(receipt, captured, quote as never)).toBe(true);
  expect(
    electricityCorrectionReceipt(
      {
        ...receipt,
        lines: receipt.lines.map((line) => Object.fromEntries(Object.entries(line).reverse())),
      },
      captured,
      quote as never
    )
  ).toBe(true);
  expect(
    electricityCorrectionReceipt(
      { ...receipt, invoiceId: captured.invoiceId },
      captured,
      quote as never
    )
  ).toBe(false);
  expect(
    electricityCorrectionReceipt(
      { ...receipt, reviewDigest: 'b'.repeat(64) },
      captured,
      quote as never
    )
  ).toBe(false);
});
it('requires a known complete rejection before clearing an attempted command', () => {
  const error = {
    code: ErrorCodes.CONFLICT_STATE.code,
    message: 'Do not show private text',
    correlationId: id('9'),
  };
  expect(definitiveElectricityRejection({ error })).toBe(true);
  expect(definitiveElectricityRejection({ error: { ...error, code: 'OTHER:UNKNOWN' } })).toBe(
    false
  );
  expect(definitiveElectricityRejection({ error: { ...error, correlationId: 'not-a-uuid' } })).toBe(
    false
  );
  expect(
    definitiveElectricityRejection({ error: { code: error.code, fields: ['postalCode'] } })
  ).toBe(false);
});
it('validates normalized address, shared postal-code rules and note without losing companion fields', () => {
  expect(electricityAddressSchema(messages).safeParse(draft).success).toBe(true);
  const result = electricityAddressSchema(messages).safeParse({
    ...draft,
    postalCode: '0123456789',
    responseNote: ' ',
  });
  expect(result.success).toBe(false);
  if (!result.success)
    expect(result.error.issues.map((issue) => issue.path[0])).toEqual([
      'postalCode',
      'responseNote',
    ]);
  expect(draft.fullAddress).toBe(' Saved address ');
});
it('rejects simple missing periods, non-positive/oversize quantities and unknown dependent geography', () => {
  expect(electricityRevisionSchema(messages, options).safeParse(draft).success).toBe(true);
  for (const totalKwh of ['0', '-1', '1.5', '1'.repeat(20)])
    expect(
      electricityRevisionSchema(messages, options).safeParse({ ...draft, totalKwh }).success
    ).toBe(false);
  expect(
    electricityRevisionSchema(messages, { ...options, periods: [] }).safeParse(draft).success
  ).toBe(false);
  expect(
    electricityRevisionSchema(messages, { ...options, locationValid: false }).safeParse(draft)
      .success
  ).toBe(false);
});
it('retains advanced date ordering and quantities while excluding server-derived mandatory green', () => {
  const advanced = { ...options, advanced: true, mandatoryGreen: true };
  expect(
    electricityRevisionSchema(messages, advanced).safeParse({ ...draft, green: 'derived' }).success
  ).toBe(true);
  expect(
    electricityRevisionSchema(messages, advanced).safeParse({ ...draft, endAt: draft.startAt })
      .success
  ).toBe(false);
  expect(
    electricityRevisionSchema(messages, advanced).safeParse({ ...draft, thermal: '0', green: '50' })
      .success
  ).toBe(false);
  expect(
    electricityRevisionSchema(messages, advanced).safeParse({ ...draft, freeMarket: '-1' }).success
  ).toBe(false);
});
