import { expect, it } from 'vitest';
import { solarTrackingSchema } from './solar-tracking-form-schemas.js';
import {
  confirmedSolarTracking,
  definitiveSolarTrackingRejection,
  solarTrackingCommand,
  solarTrackingReview,
  solarTrackingSnapshot,
  type SolarTrackingSnapshot,
} from './solar-tracking-form.js';
const captured: SolarTrackingSnapshot = {
  requestId: '89000000-0000-4000-8000-000000000001',
  profileId: '89000000-0000-4000-8000-000000000002',
  requestStatus: 'waiting_for_postal_submission',
  postalStatus: 'shipped',
  courier: 'Courier',
  trackingNumber: 'Parcel-1',
  sendDate: '2026-10-01',
  receiptImageId: null,
  estimatedArrivalDate: null,
  trackingUrl: null,
  note: null,
  revision: 2,
  recordedAt: null,
  canEdit: true,
};
const raw = {
  estimatedArrivalDate: '2026-10-03',
  trackingUrl: '  https://Courier.example:443  ',
  note: '  Delivered tomorrow  ',
};
const body = solarTrackingCommand(raw, 2, '89000000-0000-4000-8000-000000000003');
const messages = { estimatedArrivalDate: 'day', trackingUrl: 'url', note: 'note' };
const receipt = { ...captured, ...body, revision: 3, recordedAt: '2026-10-02T10:00:00Z' };
const review = () => ({
  schemaVersion: 1,
  hash: 'a'.repeat(64),
  scope: {
    action: 'solar.postal.tracking',
    profileId: captured.profileId,
    resourceId: captured.requestId,
  },
  data: {
    ...captured,
    ...body,
    previousEstimatedArrivalDate: null,
    previousTrackingUrl: null,
    previousNote: null,
    expectedRevision: 2,
    customerVisible: true,
    confirmsReceipt: false,
    createsContract: false,
    collectsPayment: false,
  },
});
it('normalizes the immutable command while retaining the raw draft and optional empty values', () => {
  expect(body.trackingUrl).toBe('https://courier.example/');
  expect(body.note).toBe('Delivered tomorrow');
  expect(raw.note).toBe('  Delivered tomorrow  ');
  expect(
    solarTrackingCommand(
      { estimatedArrivalDate: '', trackingUrl: ' ', note: ' Valid ' },
      0,
      body.idempotencyKey
    )
  ).toMatchObject({ estimatedArrivalDate: null, trackingUrl: null, note: 'Valid' });
});
it('validates trimmed note and URL boundaries with owned identifiers', () => {
  const schema = solarTrackingSchema(messages, captured.sendDate);
  expect(schema.safeParse({ ...raw, note: `  ${'n'.repeat(1000)}  ` }).success).toBe(true);
  for (const note of ['', ' ', 'n'.repeat(1001)]) {
    const value = schema.safeParse({ ...raw, note });
    expect(value.success).toBe(false);
    if (!value.success) expect(value.error.issues.map((item) => item.path)).toEqual([['note']]);
  }
  const url = 'https://courier.example/' + 'a'.repeat(2000 - 'https://courier.example/'.length);
  expect(schema.safeParse({ ...raw, trackingUrl: url }).success).toBe(true);
  expect(schema.safeParse({ ...raw, trackingUrl: url + 'a' }).success).toBe(false);
});
it('requires a real canonical estimate no earlier than this parcel and safe public HTTPS', () => {
  const schema = solarTrackingSchema(messages, captured.sendDate);
  for (const date of ['2026-09-30', '2026-02-30', '2026-10-03-invalid', '2026-10-03T00:00:00Z'])
    expect(schema.safeParse({ ...raw, estimatedArrivalDate: date }).success).toBe(false);
  expect(schema.safeParse({ ...raw, estimatedArrivalDate: '' }).success).toBe(true);
  expect(solarTrackingSchema(messages, null).safeParse(raw).success).toBe(false);
  for (const url of [
    'http://courier.example',
    'https://user:secret@courier.example',
    'https://127.0.0.1',
    'https://courier.local',
    'https://courier.example:444',
    'https://courier.example/a b',
  ])
    expect(schema.safeParse({ ...raw, trackingUrl: url }).success).toBe(false);
});
it('requires the exact reviewed parcel, command, previous values and protected semantics', () => {
  expect(solarTrackingReview(review(), captured, body)).toBe(true);
  for (const patch of [
    { profileId: '89000000-0000-4000-8000-000000000009' },
    { receiptImageId: '89000000-0000-4000-8000-000000000004' },
    { trackingNumber: 'Other parcel' },
    { revision: 3 },
    { previousNote: 'Changed' },
    { note: raw.note },
    { confirmsReceipt: true },
    { customerVisible: false },
  ]) {
    const value = review();
    expect(
      solarTrackingReview({ ...value, data: { ...value.data, ...patch } }, captured, body)
    ).toBe(false);
  }
  expect(solarTrackingReview({ ...review(), hash: 'secret' }, captured, body)).toBe(false);
  expect(solarTrackingReview({ ...review(), schemaVersion: 2 }, captured, body)).toBe(false);
  expect(
    solarTrackingReview(
      { ...review(), scope: { ...review().scope, resourceId: captured.profileId } },
      captured,
      body
    )
  ).toBe(false);
});
it('clears only for exact normalized parcel/revision proof, never old editable state', () => {
  const { canEdit: _canEdit, ...write } = receipt;
  expect(confirmedSolarTracking(write, captured, body)).toBe(true);
  expect(confirmedSolarTracking(captured, captured, body)).toBe(false);
  for (const patch of [
    { profileId: body.idempotencyKey },
    { trackingNumber: 'Resent' },
    { receiptImageId: body.idempotencyKey },
    { revision: 2 },
    { revision: 4 },
    { recordedAt: null },
    { note: raw.note },
    { trackingUrl: raw.trackingUrl },
    { sendDate: '2026-10-01-invalid' },
    { sendDate: '2026-10-01T00:00:00Z' },
    { estimatedArrivalDate: '2026-10-03-invalid' },
  ])
    expect(confirmedSolarTracking({ ...write, ...patch }, captured, body)).toBe(false);
});
it('rejects malformed fresh private reads', () => {
  expect(solarTrackingSnapshot(captured)).toBe(true);
  for (const value of [
    null,
    [],
    { ...captured, profileId: undefined },
    { ...captured, canEdit: 'yes' },
    { ...captured, receiptImageId: undefined },
    { ...captured, revision: NaN },
    { ...captured, recordedAt: 'invalid' },
    { ...captured, sendDate: '2026-02-30' },
  ])
    expect(solarTrackingSnapshot(value)).toBe(false);
});
it('accepts only a wellformed definitive rejection envelope for owned command recovery', () => {
  const error = {
    code: 'VALIDATION:INPUT_INVALID',
    message: 'Private validation',
    correlationId: captured.requestId,
  };
  expect(definitiveSolarTrackingRejection({ error })).toBe(true);
  for (const value of [
    null,
    { error: 'Invalid' },
    { error: { ...error, correlationId: '' } },
    { error: { ...error, message: undefined } },
    { error: { ...error, code: '' } },
  ])
    expect(definitiveSolarTrackingRejection(value)).toBe(false);
});
