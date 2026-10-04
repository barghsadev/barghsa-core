import { HttpException } from '@nestjs/common';
import { expect, it, vi } from 'vitest';
import { InputFieldException } from '../common/input-field.exception.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import {
  CustomerElectricityIncreaseController,
  StaffElectricityIncreaseController,
} from './electricity-increase.controller.js';

const id = '12000000-0000-4000-8000-000000000001';
const key = '12000000-0000-4000-8000-000000000002';
const hash = 'a'.repeat(64);
const actor = {
  session: { userId: 'reviewer', operatingContext: 'staff', permissions: ['contracts:write'] },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest;
const request = { requestedKwh: '12', expectedVersionId: id, idempotencyKey: key };
const approval = { effectiveFrom: '2026-11-01T10:00:00+03:30' };
const rejection = { reason: '  Explain the decision  ' };
const command = { idempotencyKey: key, expectedReviewHash: hash };
type Target = 'submit' | 'approve' | 'approveReview' | 'reject' | 'rejectReview';
const bodies: Record<Target, Record<string, unknown>> = {
  submit: request,
  approve: { ...approval, ...command },
  approveReview: approval,
  reject: { ...rejection, ...command },
  rejectReview: rejection,
};

function fixture() {
  const service = {
    submit: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
    decisionReview: vi.fn(),
    sign: vi.fn(),
  };
  const customer = new CustomerElectricityIncreaseController(service as never);
  const staff = new StaffElectricityIncreaseController(service as never);
  return {
    service,
    customer,
    invoke(target: Target, body: unknown, session = actor) {
      return target === 'submit'
        ? customer.submit(id, body, session)
        : staff[target](id, body, session);
    },
  };
}

function failure(value: ReturnType<typeof fixture>, call: () => unknown) {
  try {
    call();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    for (const method of Object.values(value.service)) expect(method).not.toHaveBeenCalled();
    expect(JSON.stringify((error as HttpException).getResponse())).not.toContain('PRIVATE');
    return error as HttpException;
  }
  throw new Error('Expected rejected input');
}

it.each([
  { target: 'submit', patch: { requestedKwh: 'PRIVATE' }, field: 'requestedKwh' },
  { target: 'submit', patch: { requestedKwh: '0' }, field: 'requestedKwh' },
  { target: 'submit', patch: { requestedKwh: '1'.repeat(20) }, field: 'requestedKwh' },
  { target: 'approve', patch: { effectiveFrom: 'PRIVATE' }, field: 'effectiveFrom' },
  { target: 'approveReview', patch: { effectiveFrom: null }, field: 'effectiveFrom' },
  { target: 'reject', patch: { reason: 'PRIVATE'.repeat(143) }, field: 'reason' },
  { target: 'rejectReview', patch: { reason: ' ' }, field: 'reason' },
] as const)('projects only the editable $field at $target', ({ target, patch, field }) => {
  const value = fixture();
  const error = failure(value, () => value.invoke(target, { ...bodies[target], ...patch }));
  expect(error.getStatus()).toBe(400);
  expect(error).toBeInstanceOf(InputFieldException);
  expect((error as InputFieldException).fields).toEqual([field]);
});

it.each(Object.keys(bodies) as Target[])(
  'keeps mixed protected failures generic at %s',
  (target) => {
    const value = fixture();
    const field =
      target === 'submit'
        ? 'requestedKwh'
        : target.startsWith('approve')
          ? 'effectiveFrom'
          : 'reason';
    const body = { ...bodies[target], [field]: null, idempotencyKey: 'PRIVATE' };
    const error = failure(value, () => value.invoke(target, body));
    expect(error.getStatus()).toBe(400);
    expect(error).not.toBeInstanceOf(InputFieldException);
  }
);

it.each(Object.keys(bodies) as Target[])('keeps extra/private fields generic at %s', (target) => {
  const value = fixture();
  const error = failure(value, () =>
    value.invoke(target, { ...bodies[target], privateValue: 'PRIVATE' })
  );
  expect(error.getStatus()).toBe(400);
  expect(error).not.toBeInstanceOf(InputFieldException);
});

it.each(['approve', 'approveReview', 'reject', 'rejectReview'] as const)(
  'denies missing staff authority before form feedback at %s',
  (target) => {
    const value = fixture();
    const error = failure(value, () =>
      value.invoke(target, null, {
        ...actor,
        session: { ...actor.session, permissions: [] },
      } as unknown as AuthenticatedRequest)
    );
    expect(error.getStatus()).toBe(403);
    expect(error).not.toBeInstanceOf(InputFieldException);
  }
);

it.each([null, [], 'PRIVATE'])('keeps structural request bodies generic (%#)', (body) => {
  const value = fixture();
  const error = failure(value, () => value.invoke('submit', body));
  expect(error).not.toBeInstanceOf(InputFieldException);
});

it('retains exact request keys/versions, offset dates and normalized maximum-length reasons', () => {
  const value = fixture();
  value.invoke('submit', request);
  expect(value.service.submit).toHaveBeenCalledWith(id, request, actor.session, actor.ip);
  value.invoke('approve', { ...approval, ...command });
  expect(value.service.approve).toHaveBeenCalledWith(
    id,
    { ...approval, ...command },
    actor.session,
    actor.ip
  );
  value.invoke('approveReview', {});
  expect(value.service.decisionReview).toHaveBeenCalledWith(id, 'approve', {}, actor.session);
  const reason = 'x'.repeat(1000);
  value.invoke('reject', { reason: `  ${reason}  `, ...command });
  expect(value.service.reject).toHaveBeenCalledWith(
    id,
    { reason, ...command },
    actor.session,
    actor.ip
  );
  value.invoke('rejectReview', { reason: ` ${reason} ` });
  expect(value.service.decisionReview).toHaveBeenCalledWith(
    id,
    'reject',
    { reason },
    actor.session
  );
});

it('preserves generic signing/protected identity failures without calling the service', () => {
  const value = fixture();
  const error = failure(value, () =>
    value.customer.sign(
      id,
      {
        expectedAmendmentSha256: 'PRIVATE',
        expectedAdjustmentIrR: '0',
        ...command,
      },
      actor
    )
  );
  expect(error).not.toBeInstanceOf(InputFieldException);
  const invalidId = failure(value, () => value.customer.submit('PRIVATE', request, actor));
  expect(invalidId).not.toBeInstanceOf(InputFieldException);
});
