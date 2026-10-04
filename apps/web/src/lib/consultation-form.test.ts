import { expect, it } from 'vitest';
import { safeParse } from 'zod/mini';
import {
  confirmedConsultationInformation,
  consultationIntakeReceipt,
  consultationReceipt,
  definitiveConsultationRejection,
  type ConsultationInformationCommand,
} from './consultation-form.js';
import {
  inactiveIntakeSchema,
  inactiveReasonSchema,
  intakeSchema,
  reasonSchema,
} from './consultation-form-schemas.js';
const requestId = '11111111-1111-4111-8111-111111111111',
  profileId = '22222222-2222-4222-8222-222222222222';
it('requires a valid product and explicit confirmation without altering raw input', () => {
  const schema = intakeSchema({ productId: 'product', confirm: 'confirm' });
  expect(safeParse(schema, { productId: requestId, confirm: true }).success).toBe(true);
  for (const productId of ['', 'private', ` ${requestId} `])
    expect(safeParse(schema, { productId, confirm: true }).success).toBe(false);
  expect(safeParse(schema, { productId: requestId, confirm: false }).success).toBe(false);
});
it.each([2000, 1000])(
  'validates the current reason intent through exactly %s trimmed characters',
  (max) => {
    const schema = reasonSchema('localized', max);
    for (const reason of ['', ' ', 'x'.repeat(max + 1)])
      expect(safeParse(schema, { reason }).success).toBe(false);
    const reason = ' ' + 'x'.repeat(max) + ' ';
    expect(safeParse(schema, { reason })).toMatchObject({ success: true, data: { reason } });
  }
);
it('inactive schemas add no old errors after a deferred scope changes', () => {
  expect(safeParse(inactiveReasonSchema, { reason: '' }).success).toBe(true);
  expect(safeParse(inactiveIntakeSchema, { productId: '', confirm: false }).success).toBe(true);
});
it('accepts only exact request/status acknowledgements and UUID creation receipts', () => {
  expect(consultationIntakeReceipt({ requestId, status: 'submitted' })).toBe(true);
  for (const value of [
    { requestId },
    { requestId, status: 'completed' },
    { requestId: 'private', status: 'submitted' },
    null,
  ])
    expect(consultationIntakeReceipt(value)).toBe(false);
  expect(
    consultationReceipt({ requestId, status: 'under_review' }, requestId, 'under_review')
  ).toBe(true);
  for (const value of [
    { requestId: profileId, status: 'under_review' },
    { requestId, status: 'submitted' },
    {},
  ])
    expect(consultationReceipt(value, requestId, 'under_review')).toBe(false);
});
it('only a wellformed API 4xx establishes a definitive rejection', () => {
  const value = { error: { code: 'CONFLICT', message: 'Private text', correlationId: requestId } };
  expect(definitiveConsultationRejection(409, value)).toBe(true);
  expect(definitiveConsultationRejection(503, value)).toBe(false);
  for (const body of [
    null,
    {},
    { error: { code: 'CONFLICT' } },
    { error: { code: 'CONFLICT', message: 'private', correlationId: '' } },
  ])
    expect(definitiveConsultationRejection(400, body)).toBe(false);
});
it('requires the same authorized request/profile, unchanged history prefix and new exact customer reply', () => {
  const event = {
    status: 'awaiting_customer_info',
    actor_type: 'staff',
    reason: 'Please provide details',
    created_at: '2026-10-01T10:00:00Z',
  };
  const command: ConsultationInformationCommand = {
    requestId,
    profileId,
    reason: 'Captured information',
    history: [event],
  };
  const correct = {
    status: 'under_review',
    actor_type: 'customer',
    reason: command.reason,
    created_at: '2026-10-01T11:00:00Z',
  };
  const value = {
    request: { id: requestId, profile_id: profileId, status: 'under_review' },
    history: [event, { ...correct, reason: 'Unrelated information' }, correct],
  };
  expect(confirmedConsultationInformation(value, command)).toBe(true);
  expect(
    confirmedConsultationInformation(
      { ...value, request: { ...value.request, status: 'completed' } },
      command
    )
  ).toBe(true);
  for (const patch of [
    { history: [event] },
    { history: [{ ...event, reason: 'changed' }, correct] },
    { history: [event, { ...correct, actor_type: 'staff' }] },
    { history: [event, { ...correct, reason: 'Other' }] },
    { history: [event, { ...correct, created_at: 'malformed' }] },
    { request: { ...value.request, id: profileId } },
    { request: { ...value.request, profile_id: requestId } },
  ])
    expect(confirmedConsultationInformation({ ...value, ...patch }, command)).toBe(false);
  const prior = { ...command, history: [event, correct] };
  expect(confirmedConsultationInformation({ ...value, history: [event, correct] }, prior)).toBe(
    false
  );
});
