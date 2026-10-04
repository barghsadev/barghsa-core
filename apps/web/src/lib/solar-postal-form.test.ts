import { expect, it } from 'vitest';
import { safeParse } from 'zod/mini';
import {
  confirmedPostalDecision,
  confirmedPostalGuidance,
  confirmedShipmentRead,
  emptyShipment,
  postalGuidanceBody,
  shipmentBody,
  shipmentReceipt,
} from './solar-postal-form.js';
import {
  postalGuidanceSchema,
  postalReasonSchema,
  shipmentSchema,
} from './solar-postal-form-schemas.js';
const shipment = {
  courier: ' Courier ',
  trackingNumber: ' Tracking ',
  sendDate: '2026-01-02',
  receiptImageId: '',
};
const shipmentMessages = {
  courier: 'courier',
  trackingNumber: 'tracking',
  sendDate: 'UTC day',
  receiptImageId: 'receipt',
};
const guidance = {
  fa: ' راهنما ',
  en: ' Guidance ',
  destinationAddress: ' Address ',
  contactDetails: ' Contact ',
  originalsFa: ' سند اول \n\n سند دوم ',
  originalsEn: ' First \n Second ',
};
const guidanceMessages = {
  fa: 'fa',
  en: 'en',
  destinationAddress: 'address',
  contactDetails: 'contact',
  originalsFa: 'originals',
  originalsEn: 'originals',
};
const paths = (value: ReturnType<typeof safeParse>) =>
  value.success ? [] : value.error.issues.map((issue) => issue.path.join('.'));
for (const [field, limit] of [
  ['courier', 100],
  ['trackingNumber', 200],
] as const)
  it(`${field} preserves raw input and enforces its trimmed required boundary`, () => {
    const schema = shipmentSchema(shipmentMessages, '2026-01-02');
    expect(safeParse(schema, { ...shipment, [field]: ' ' + 'x'.repeat(limit) + ' ' }).success).toBe(
      true
    );
    for (const value of ['', ' ', 'x'.repeat(limit + 1)])
      expect(paths(safeParse(schema, { ...shipment, [field]: value }))).toEqual([field]);
  });
it('requires a real UTC calendar day and no future day, and validates an optional receipt UUID', () => {
  const schema = shipmentSchema(shipmentMessages, '2026-01-02');
  for (const day of ['', '2026-01-03', '2025-02-29', '2026-13-01', '2026-01-02T00:00:00Z'])
    expect(paths(safeParse(schema, { ...shipment, sendDate: day }))).toEqual(['sendDate']);
  expect(safeParse(schema, { ...shipment, sendDate: '2024-02-29' }).success).toBe(true);
  expect(
    safeParse(schema, { ...shipment, receiptImageId: '11111111-1111-4111-8111-111111111111' })
      .success
  ).toBe(true);
  expect(paths(safeParse(schema, { ...shipment, receiptImageId: 'private' }))).toEqual([
    'receiptImageId',
  ]);
  expect(paths(safeParse(schema, emptyShipment))).toEqual([
    'courier',
    'trackingNumber',
    'sendDate',
  ]);
  expect(shipmentBody(shipment)).toEqual({
    courier: 'Courier',
    trackingNumber: 'Tracking',
    sendDate: '2026-01-02',
  });
});
it('requires shipment acknowledgement and all fresh committed postal fields, including nullable receipt', () => {
  const body = shipmentBody(shipment);
  const value = {
    requestStatus: 'waiting_for_postal_submission',
    postal: {
      status: 'shipped',
      courier: 'Courier',
      tracking_number: 'Tracking',
      send_date: '2026-01-02',
      receipt_image_id: null,
    },
  };
  expect(shipmentReceipt({ status: 'shipped' })).toBe(true);
  expect(shipmentReceipt({ status: 'received' })).toBe(false);
  expect(confirmedShipmentRead(value, body)).toBe(true);
  expect(
    confirmedShipmentRead({ ...value, postal: { ...value.postal, status: 'received' } }, body)
  ).toBe(true);
  for (const patch of [
    { courier: 'other' },
    { tracking_number: 'other' },
    { send_date: '2026-01-03' },
    { receipt_image_id: 'unexpected' },
    { status: 'incomplete' },
    { status: 'not_received' },
  ])
    expect(confirmedShipmentRead({ ...value, postal: { ...value.postal, ...patch } }, body)).toBe(
      false
    );
  for (const send_date of [
    '2026-01-02-invalid',
    '2026-01-02T99:00:00Z',
    '2026-01-02T23:00:00-04:00',
  ])
    expect(confirmedShipmentRead({ ...value, postal: { ...value.postal, send_date } }, body)).toBe(
      false
    );
  expect(
    confirmedShipmentRead(
      { ...value, postal: { ...value.postal, send_date: '2026-01-02T00:00:00Z' } },
      body
    )
  ).toBe(false);
  expect(confirmedShipmentRead(null, body)).toBe(false);
});
for (const [field, limit, required] of [
  ['fa', 4000, true],
  ['en', 4000, true],
  ['destinationAddress', 2000, false],
  ['contactDetails', 1000, false],
] as const)
  it(`postal guidance ${field} enforces its exact boundary and requiredness`, () => {
    const schema = postalGuidanceSchema(guidanceMessages);
    expect(safeParse(schema, { ...guidance, [field]: ' ' + 'x'.repeat(limit) + ' ' }).success).toBe(
      true
    );
    expect(paths(safeParse(schema, { ...guidance, [field]: 'x'.repeat(limit + 1) }))).toEqual([
      field,
    ]);
    expect(safeParse(schema, { ...guidance, [field]: '' }).success).toBe(!required);
  });
it('requires ordered paired original lines, with thirty 200-character lines allowed and empty paired lists valid', () => {
  const schema = postalGuidanceSchema(guidanceMessages);
  const lines = Array.from({ length: 30 }, () => 'x'.repeat(200)).join('\n');
  expect(safeParse(schema, { ...guidance, originalsFa: lines, originalsEn: lines }).success).toBe(
    true
  );
  expect(
    paths(
      safeParse(schema, {
        ...guidance,
        originalsFa: lines + '\nlast',
        originalsEn: lines + '\nlast',
      })
    )
  ).toEqual(['originalsFa', 'originalsEn']);
  expect(
    paths(safeParse(schema, { ...guidance, originalsFa: 'x'.repeat(201) + '\nSecond' }))
  ).toEqual(['originalsFa']);
  expect(paths(safeParse(schema, { ...guidance, originalsEn: 'One' }))).toEqual([
    'originalsFa',
    'originalsEn',
  ]);
  expect(safeParse(schema, { ...guidance, originalsFa: ' \n', originalsEn: '' }).success).toBe(
    true
  );
  const body = postalGuidanceBody(guidance);
  expect(body).toEqual({
    fa: 'راهنما',
    en: 'Guidance',
    destinationAddress: 'Address',
    contactDetails: 'Contact',
    originals: [
      { fa: 'سند اول', en: 'First' },
      { fa: 'سند دوم', en: 'Second' },
    ],
  });
  expect(confirmedPostalGuidance(body, body)).toBe(true);
  for (const receipt of [
    null,
    { ...body, contactDetails: 'Other' },
    { ...body, destinationAddress: 'Other' },
    { ...body, originals: [...body.originals].reverse() },
  ])
    expect(confirmedPostalGuidance(receipt, body)).toBe(false);
});
it('requires meaningful issue/final reason text through exactly1000 characters', () => {
  const schema = postalReasonSchema('localized');
  for (const reason of ['', ' ', 'x'.repeat(1001)])
    expect(paths(safeParse(schema, { reason }))).toEqual(['reason']);
  expect(safeParse(schema, { reason: ' ' + 'x'.repeat(1000) + ' ' }).success).toBe(true);
});
it('verifies every postal/final receipt against the captured action outcome', () => {
  for (const [action, receipt] of [
    ['confirm-received', { status: 'received', requestStatus: 'postal_documents_received' }],
    ['mark-incomplete', { status: 'incomplete', requestStatus: 'waiting_for_postal_submission' }],
    [
      'mark-not-received',
      { status: 'not_received', requestStatus: 'waiting_for_postal_submission' },
    ],
    ['final-approve', { status: 'approved' }],
    ['final-reject', { status: 'rejected' }],
    ['close-no-contract', { status: 'cancelled' }],
    ['start-final-review', { status: 'final_review' }],
  ] as const) {
    expect(confirmedPostalDecision(receipt, `/api/${action}`)).toBe(true);
    expect(confirmedPostalDecision({ ...receipt, status: 'wrong' }, `/api/${action}`)).toBe(false);
  }
  expect(confirmedPostalDecision({}, '/api/confirm-received')).toBe(false);
  expect(confirmedPostalDecision({ status: 'received' }, '/api/confirm-received')).toBe(false);
});
