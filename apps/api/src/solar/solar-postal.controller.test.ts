import { expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { InputFieldException } from '../common/input-field.exception.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { SolarPostalController, StaffSolarPostalController } from './solar-postal.controller.js';
import { StaffSolarFinalController } from './solar-final.controller.js';

const requestId = '11000000-0000-4000-8000-000000000001';
const receiptId = '12000000-0000-4000-8000-000000000001';
const hash = 'a'.repeat(64);
const request = {
  session: {
    userId: 'reviewer',
    operatingContext: 'staff',
    permissions: ['orders:write', 'contracts:write', 'admin:catalogue:edit'],
  },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest;
const guidance = {
  fa: 'مدارک',
  en: 'Documents',
  destinationAddress: '',
  contactDetails: '',
  originals: [],
};
const shipment = { courier: 'Courier', trackingNumber: 'TRACK-1', sendDate: '2026-02-28' };

function fixture() {
  const postal = {
    shipment: vi.fn(),
    setGuidance: vi.fn((_actor, value) => value),
    reviewDecision: vi.fn(),
    decide: vi.fn(),
  };
  const final = { reviewDecision: vi.fn(), decide: vi.fn() };
  return {
    postal,
    final,
    customer: new SolarPostalController(postal as never),
    staff: new StaffSolarPostalController(postal as never, {} as never),
    finalStaff: new StaffSolarFinalController(final as never, {} as never),
  };
}
function failure(call: () => unknown) {
  try {
    call();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    return error as HttpException;
  }
  throw new Error('Expected validation rejection');
}
function noCalls(value: ReturnType<typeof fixture>) {
  for (const method of [...Object.values(value.postal), ...Object.values(value.final)])
    expect(method).not.toHaveBeenCalled();
}
function owned(call: () => unknown, fields: string[]) {
  const error = failure(call);
  expect(error).toBeInstanceOf(InputFieldException);
  expect((error as InputFieldException).fields).toEqual(fields);
  expect(JSON.stringify(error.getResponse())).not.toContain('PRIVATE');
}

it.each([
  [{ ...shipment, courier: null }, ['courier']],
  [{ ...shipment, courier: ' ' }, ['courier']],
  [{ ...shipment, courier: 'PRIVATE'.repeat(15) }, ['courier']],
  [{ ...shipment, trackingNumber: 'PRIVATE'.repeat(29) }, ['trackingNumber']],
  [{ ...shipment, sendDate: '2026-02-30' }, ['sendDate']],
  [{ ...shipment, sendDate: 'PRIVATE' }, ['sendDate']],
  [{ ...shipment, receiptImageId: 'PRIVATE' }, ['receiptImageId']],
  [{ ...shipment, receiptImageId: null }, ['receiptImageId']],
] as const)('projects only owned shipment fields (%#)', (body, fields) => {
  const value = fixture();
  owned(() => value.customer.shipment(requestId, body, request), [...fields]);
  noCalls(value);
});

it.each([
  [{ ...guidance, fa: 'PRIVATE'.repeat(572) }, ['fa']],
  [{ ...guidance, en: ' ' }, ['en']],
  [{ ...guidance, destinationAddress: 'PRIVATE'.repeat(286) }, ['destinationAddress']],
  [{ ...guidance, contactDetails: 'PRIVATE'.repeat(143) }, ['contactDetails']],
  [{ ...guidance, originals: [{ fa: '', en: 'Valid' }] }, ['originalsFa']],
  [{ ...guidance, originals: [{ fa: 'درست', en: 'PRIVATE'.repeat(29) }] }, ['originalsEn']],
  [
    { ...guidance, originals: Array.from({ length: 31 }, () => ({ fa: 'مدرک', en: 'Document' })) },
    ['originalsFa', 'originalsEn'],
  ],
] as const)('projects postal guidance to the owning controls (%#)', (body, fields) => {
  const value = fixture();
  owned(() => value.staff.setGuidance(body, request), [...fields]);
  noCalls(value);
});

it.each([undefined, null, 42, '', ' ', 'PRIVATE'.repeat(143)])(
  'requires postal and final issue reasons at preview and commit (%#)',
  (reason) => {
    const value = fixture();
    for (const decision of ['incomplete', 'not_received'] as const)
      owned(() => value.staff.reviewDecision(requestId, { decision, reason }, request), ['reason']);
    owned(
      () => value.staff.incomplete(requestId, { reason, expectedReviewHash: hash }, request),
      ['reason']
    );
    owned(
      () => value.staff.notReceived(requestId, { reason, expectedReviewHash: hash }, request),
      ['reason']
    );
    for (const decision of ['reject', 'close-no-contract'] as const)
      owned(
        () => value.finalStaff.reviewDecision(requestId, { decision, reason }, request),
        ['reason']
      );
    owned(
      () => value.finalStaff.reject(requestId, { reason, expectedReviewHash: hash }, request),
      ['reason']
    );
    owned(
      () => value.finalStaff.close(requestId, { reason, expectedReviewHash: hash }, request),
      ['reason']
    );
    noCalls(value);
  }
);

it('accepts every exact text/list boundary and forwards only normalized captured values', () => {
  const value = fixture();
  const expectedShipment = {
    courier: 'c'.repeat(100),
    trackingNumber: 't'.repeat(200),
    sendDate: '2026-02-28',
    receiptImageId: receiptId,
  };
  value.customer.shipment(
    requestId,
    { ...expectedShipment, courier: ` ${expectedShipment.courier} ` },
    request
  );
  expect(value.postal.shipment).toHaveBeenCalledWith(
    request.session,
    requestId,
    expectedShipment,
    request.ip
  );
  const expectedGuidance = {
    fa: 'ف'.repeat(4000),
    en: 'e'.repeat(4000),
    destinationAddress: 'a'.repeat(2000),
    contactDetails: 'c'.repeat(1000),
    originals: Array.from({ length: 30 }, () => ({ fa: 'ف'.repeat(200), en: 'e'.repeat(200) })),
  };
  expect(
    value.staff.setGuidance({ ...expectedGuidance, fa: ` ${expectedGuidance.fa} ` }, request)
  ).toEqual(expectedGuidance);
  const reason = 'ر'.repeat(1000);
  for (const decision of ['incomplete', 'not_received'] as const) {
    value.staff.reviewDecision(requestId, { decision, reason: ` ${reason} ` }, request);
    expect(value.postal.reviewDecision).toHaveBeenLastCalledWith(
      request.session,
      requestId,
      decision,
      reason
    );
  }
  value.staff.incomplete(requestId, { reason: ` ${reason} `, expectedReviewHash: hash }, request);
  expect(value.postal.decide).toHaveBeenLastCalledWith(
    request.session,
    requestId,
    'incomplete',
    reason,
    hash,
    request.ip
  );
  value.staff.notReceived(requestId, { reason, expectedReviewHash: hash }, request);
  expect(value.postal.decide).toHaveBeenLastCalledWith(
    request.session,
    requestId,
    'not_received',
    reason,
    hash,
    request.ip
  );
  for (const decision of ['reject', 'close-no-contract'] as const) {
    value.finalStaff.reviewDecision(requestId, { decision, reason: ` ${reason} ` }, request);
    expect(value.final.reviewDecision).toHaveBeenLastCalledWith(
      request.session,
      requestId,
      decision,
      reason
    );
  }
  value.finalStaff.reject(requestId, { reason, expectedReviewHash: hash }, request);
  expect(value.final.decide).toHaveBeenLastCalledWith(
    request.session,
    requestId,
    'reject',
    reason,
    hash,
    request.ip
  );
  value.finalStaff.close(requestId, { reason, expectedReviewHash: hash }, request);
  expect(value.final.decide).toHaveBeenLastCalledWith(
    request.session,
    requestId,
    'close-no-contract',
    reason,
    hash,
    request.ip
  );
});

it('preserves empty optional lists/address/contact and reason-free received/approval commands', () => {
  const value = fixture();
  expect(value.staff.setGuidance(guidance, request)).toEqual(guidance);
  value.staff.reviewDecision(requestId, { decision: 'received' }, request);
  expect(value.postal.reviewDecision).toHaveBeenLastCalledWith(
    request.session,
    requestId,
    'received',
    undefined
  );
  value.staff.received(requestId, { expectedReviewHash: hash }, request);
  expect(value.postal.decide).toHaveBeenLastCalledWith(
    request.session,
    requestId,
    'received',
    undefined,
    hash,
    request.ip
  );
  value.finalStaff.reviewDecision(requestId, { decision: 'approve' }, request);
  expect(value.final.reviewDecision).toHaveBeenLastCalledWith(
    request.session,
    requestId,
    'approve',
    undefined
  );
  value.finalStaff.approve(requestId, { expectedReviewHash: hash }, request);
  expect(value.final.decide).toHaveBeenLastCalledWith(
    request.session,
    requestId,
    'approve',
    undefined,
    hash,
    request.ip
  );
});

it('keeps structural, unknown, protected and mixed errors generic with zero service calls', () => {
  const value = fixture();
  for (const call of [
    () => value.customer.shipment(requestId, null, request),
    () =>
      value.customer.shipment(requestId, { ...shipment, courier: '', secret: 'PRIVATE' }, request),
    () => value.staff.setGuidance({ ...guidance, originals: 'PRIVATE' }, request),
    () => value.staff.setGuidance({ ...guidance, originals: [null] }, request),
    () =>
      value.staff.setGuidance(
        { ...guidance, originals: [{ fa: '', en: 'Valid', secret: 'PRIVATE' }] },
        request
      ),
    () => value.staff.setGuidance({ ...guidance, fa: '', secret: 'PRIVATE' }, request),
    () => value.staff.reviewDecision(requestId, { decision: 'PRIVATE', reason: '' }, request),
    () => value.staff.incomplete(requestId, { reason: '', expectedReviewHash: 'PRIVATE' }, request),
    () =>
      value.staff.notReceived(
        requestId,
        { reason: '', expectedReviewHash: hash, secret: 'PRIVATE' },
        request
      ),
    () => value.finalStaff.reviewDecision(requestId, { decision: 'PRIVATE', reason: '' }, request),
    () =>
      value.finalStaff.reject(requestId, { reason: '', expectedReviewHash: 'PRIVATE' }, request),
    () =>
      value.finalStaff.close(
        requestId,
        { reason: '', expectedReviewHash: hash, secret: 'PRIVATE' },
        request
      ),
  ]) {
    const error = failure(call);
    expect(error.getStatus()).toBe(400);
    expect(error).not.toBeInstanceOf(InputFieldException);
    expect(JSON.stringify(error.getResponse())).not.toContain('PRIVATE');
  }
  noCalls(value);
});

it('checks the actual owning staff grant before exposing any field feedback', () => {
  const value = fixture();
  const actor = (permissions: string[], operatingContext = 'staff') =>
    ({
      session: { userId: 'reviewer', operatingContext, permissions },
    }) as unknown as AuthenticatedRequest;
  const orders = actor(['orders:write']),
    contracts = actor(['contracts:write']);
  for (const call of [
    () => value.staff.setGuidance({ fa: '' }, orders),
    () => value.staff.reviewDecision(requestId, { decision: 'incomplete' }, contracts),
    () => value.staff.incomplete(requestId, { reason: '' }, contracts),
    () => value.finalStaff.reviewDecision(requestId, { decision: 'close-no-contract' }, orders),
    () => value.finalStaff.close(requestId, { reason: '' }, orders),
    () => value.finalStaff.reviewDecision(requestId, { decision: 'reject' }, contracts),
    () => value.finalStaff.reject(requestId, { reason: '' }, contracts),
    () => value.staff.notReceived(requestId, { reason: '' }, actor(['*'], 'customer')),
  ]) {
    const error = failure(call);
    expect(error.getStatus()).toBe(403);
    expect(error).not.toBeInstanceOf(InputFieldException);
  }
  owned(
    () => value.finalStaff.reviewDecision(requestId, { decision: 'close-no-contract' }, contracts),
    ['reason']
  );
  owned(
    () => value.finalStaff.reviewDecision(requestId, { decision: 'reject' }, orders),
    ['reason']
  );
  noCalls(value);
});
