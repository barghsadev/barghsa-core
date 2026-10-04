import { HttpException } from '@nestjs/common';
import { expect, it, vi } from 'vitest';
import { InputFieldException } from '../common/input-field.exception.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { StaffElectricityPriceAdjustmentController } from './electricity-price-adjustment.controller.js';

const id = '13000000-0000-4000-8000-000000000001';
const key = '13000000-0000-4000-8000-000000000002';
const hash = 'a'.repeat(64);
const actor = {
  session: { userId: 'reviewer', operatingContext: 'staff', permissions: ['contracts:write'] },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest;
const proposal = {
  expectedVersionId: id,
  effectiveFrom: '2026-11-01T10:00:00+03:30',
  percentageBps: '-1250',
  reason: '  Explain the proposal  ',
  contractualBasis: '  Applicable contract section  ',
};
const command = { expectedReviewHash: hash, idempotencyKey: key };
type Target = 'review' | 'propose';
const bodies: Record<Target, Record<string, unknown>> = {
  review: proposal,
  propose: { ...proposal, ...command },
};

function fixture() {
  const service = { review: vi.fn(), propose: vi.fn(), finalize: vi.fn(), cancel: vi.fn() };
  const controller = new StaffElectricityPriceAdjustmentController(service as never);
  return {
    service,
    controller,
    invoke(target: Target, body: unknown, request = actor) {
      return controller[target](id, body, request);
    },
  };
}

function failure(value: ReturnType<typeof fixture>, call: () => unknown) {
  try {
    call();
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    for (const method of Object.values(value.service)) expect(method).not.toHaveBeenCalled();
    expect(JSON.stringify(error.getResponse())).not.toContain('PRIVATE');
    return error;
  }
  throw new Error('Expected rejected input');
}

it.each(
  (['review', 'propose'] as const).flatMap((target) =>
    (['effectiveFrom', 'percentageBps', 'reason', 'contractualBasis'] as const).map((field) => ({
      target,
      field,
      invalid: field === 'reason' || field === 'contractualBasis' ? ' ' : 'PRIVATE',
    }))
  )
)('projects only editable $field at $target', ({ target, field, invalid }) => {
  const value = fixture();
  const error = failure(value, () => value.invoke(target, { ...bodies[target], [field]: invalid }));
  expect(error.getStatus()).toBe(400);
  expect(error).toBeInstanceOf(InputFieldException);
  expect((error as InputFieldException).fields).toEqual([field]);
});

it.each([
  { field: 'reason', length: 1001 },
  { field: 'contractualBasis', length: 2001 },
])('keeps existing $field maximum', ({ field, length }) => {
  const value = fixture();
  const error = failure(value, () =>
    value.invoke('propose', { ...bodies.propose, [field]: 'x'.repeat(length) })
  );
  expect(error).toBeInstanceOf(InputFieldException);
  expect((error as InputFieldException).fields).toEqual([field]);
});

it.each(['review', 'propose'] as const)(
  'keeps mixed protected failures generic at %s',
  (target) => {
    const value = fixture();
    const body = { ...bodies[target], reason: null, expectedVersionId: 'PRIVATE' };
    const error = failure(value, () => value.invoke(target, body));
    expect(error.getStatus()).toBe(400);
    expect(error).not.toBeInstanceOf(InputFieldException);
  }
);

it.each(['review', 'propose'] as const)('keeps extra fields generic at %s', (target) => {
  const value = fixture();
  const error = failure(value, () =>
    value.invoke(target, { ...bodies[target], privateValue: 'PRIVATE' })
  );
  expect(error.getStatus()).toBe(400);
  expect(error).not.toBeInstanceOf(InputFieldException);
});

it.each(['review', 'propose'] as const)(
  'denies missing authority before form feedback at %s',
  (target) => {
    const value = fixture();
    const denied = {
      ...actor,
      session: { ...actor.session, permissions: [] },
    } as unknown as AuthenticatedRequest;
    const error = failure(value, () => value.invoke(target, null, denied));
    expect(error.getStatus()).toBe(403);
    expect(error).not.toBeInstanceOf(InputFieldException);
  }
);

it.each([null, [], 'PRIVATE'])('keeps structural proposal bodies generic (%#)', (body) => {
  const value = fixture();
  const error = failure(value, () => value.invoke('propose', body));
  expect(error).not.toBeInstanceOf(InputFieldException);
});

it('retains signed basis points, offset date, protected keys and maximum-length normalization', () => {
  const value = fixture();
  const reason = 'x'.repeat(1000);
  const contractualBasis = 'y'.repeat(2000);
  const body = { ...proposal, reason: ` ${reason} `, contractualBasis: ` ${contractualBasis} ` };
  const normalized = { ...proposal, reason, contractualBasis };
  value.invoke('review', body);
  expect(value.service.review).toHaveBeenCalledWith(id, normalized, actor.session);
  value.invoke('propose', { ...body, ...command });
  expect(value.service.propose).toHaveBeenCalledWith(
    id,
    { ...normalized, ...command },
    actor.session,
    actor.ip
  );
});

it.each(['finalize', 'cancel'] as const)('keeps protected %s bodies generic', (target) => {
  const value = fixture();
  const financeActor = {
    ...actor,
    session: { ...actor.session, permissions: ['contracts:write', 'invoices:write'] },
  } as unknown as AuthenticatedRequest;
  const error = failure(value, () =>
    value.controller[target](id, { idempotencyKey: 'PRIVATE' }, financeActor)
  );
  expect(error.getStatus()).toBe(400);
  expect(error).not.toBeInstanceOf(InputFieldException);
});

it('keeps protected resource IDs generic', () => {
  const value = fixture();
  const error = failure(value, () => value.controller.propose('PRIVATE', bodies.propose, actor));
  expect(error).not.toBeInstanceOf(InputFieldException);
});
