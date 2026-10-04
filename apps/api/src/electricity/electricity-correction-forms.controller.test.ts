import { expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { InputFieldException } from '../common/input-field.exception.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { ElectricityOrderController } from './electricity-order.controller.js';
import { ElectricityStaffReviewController } from './electricity-staff-review.controller.js';

const id = '11000000-0000-4000-8000-000000000001';
const next = '11000000-0000-4000-8000-000000000002';
const hash = 'a'.repeat(64);
const actor = {
  session: { userId: 'reviewer', operatingContext: 'staff', permissions: ['contracts:write'] },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest;
const correction = {
  idempotencyKey: next,
  expectedVersionId: id,
  fullAddress: '  Corrected street  ',
  postalCode: '1234567890',
  responseNote: '  Corrected address  ',
};
const simple = { profileId: id, expectedVersionId: id, period: 'next_week', totalKwh: '10' };
const advanced = {
  profileId: id,
  expectedVersionId: id,
  startAt: '2026-11-01T00:00:00.000Z',
  endAt: '2026-11-02T00:00:00.000Z',
  quantities: { thermal: '10', green: '0', free_market: '0', energy_saving: '0' },
};
const address = {
  provinceId: id,
  cityId: next,
  fullAddress: '  Corrected street  ',
  postalCode: '1234567890',
};
function fixture() {
  const customerService = {
    resubmitAddressCorrection: vi.fn(),
    previewRevision: vi.fn(),
    resubmitRevision: vi.fn(),
  };
  const staffService = { financialReview: vi.fn(), decide: vi.fn() };
  return {
    customerService,
    staffService,
    customer: new ElectricityOrderController(customerService as never, {} as never, {} as never),
    staff: new ElectricityStaffReviewController(staffService as never),
  };
}
function failure(call: () => unknown) {
  try {
    call();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    const result = error as HttpException;
    expect(JSON.stringify(result.getResponse())).not.toContain('PRIVATE');
    return result;
  }
  throw new Error('Expected invalid command');
}
function noCalls(value: ReturnType<typeof fixture>) {
  for (const method of [
    ...Object.values(value.customerService),
    ...Object.values(value.staffService),
  ])
    expect(method).not.toHaveBeenCalled();
}

it.each([
  [{ ...correction, fullAddress: ' ' }, ['fullAddress']],
  [{ ...correction, fullAddress: 'PRIVATE'.repeat(72) }, ['fullAddress']],
  [{ ...correction, postalCode: 'PRIVATE' }, ['postalCode']],
  [{ ...correction, responseNote: null }, ['responseNote']],
  [{ ...correction, responseNote: 'PRIVATE'.repeat(143) }, ['responseNote']],
  [{ ...correction, fullAddress: ' ', postalCode: 'PRIVATE' }, ['fullAddress', 'postalCode']],
] as const)('owns address correction fields without values (%#)', (body, fields) => {
  const value = fixture();
  const error = failure(() => value.customer.resubmitAddress(id, body, actor));
  expect(error).toBeInstanceOf(InputFieldException);
  expect((error as InputFieldException).fields).toEqual([...fields]);
  noCalls(value);
});
it.each([
  { ...correction, expectedVersionId: 'PRIVATE' },
  { ...correction, idempotencyKey: 'PRIVATE', responseNote: ' ' },
  { ...correction, extra: 'PRIVATE' },
  [],
  null,
])('keeps structural or protected address failures generic (%#)', (body) => {
  const value = fixture();
  const error = failure(() => value.customer.resubmitAddress(id, body, actor));
  expect(error.getStatus()).toBe(400);
  expect(error).not.toBeInstanceOf(InputFieldException);
  noCalls(value);
});

for (const confirmed of [false, true]) {
  const phase = confirmed ? 'resubmit' : 'preview';
  const bodyFor = (body: Record<string, unknown>) =>
    confirmed
      ? {
          ...body,
          address,
          idempotencyKey: next,
          expectedQuoteDigest: hash,
          responseNote: '  Updated terms  ',
        }
      : body;
  const call = (value: ReturnType<typeof fixture>, body: unknown) =>
    confirmed
      ? value.customer.resubmitRevision(id, body, actor)
      : value.customer.revisionPreview(id, body, actor);
  it.each([
    [{ ...simple, period: 'PRIVATE' }, ['period']],
    [{ ...simple, totalKwh: 'PRIVATE' }, ['totalKwh']],
    [{ ...simple, giftCode: 'PRIVATE'.repeat(15) }, ['giftCode']],
    [{ ...advanced, startAt: 'PRIVATE' }, ['startAt']],
    [{ ...advanced, endAt: null }, ['endAt']],
    [{ ...advanced, quantities: { ...advanced.quantities, thermal: '-1' } }, ['thermal']],
    [{ ...advanced, quantities: { ...advanced.quantities, green: 'PRIVATE' } }, ['green']],
    [
      { ...advanced, quantities: { ...advanced.quantities, free_market: 'PRIVATE' } },
      ['freeMarket'],
    ],
    [
      { ...advanced, quantities: { ...advanced.quantities, energy_saving: null } },
      ['energySaving'],
    ],
  ] as const)(`owns only the selected revision variant during ${phase} (%#)`, (body, fields) => {
    const value = fixture();
    const error = failure(() => call(value, bodyFor(body)));
    expect(error).toBeInstanceOf(InputFieldException);
    expect((error as InputFieldException).fields).toEqual([...fields]);
    noCalls(value);
  });
  it.each([
    { ...simple, profileId: 'PRIVATE', totalKwh: '0' },
    { ...advanced, expectedVersionId: 'PRIVATE', startAt: 'PRIVATE' },
    { ...simple, extra: 'PRIVATE' },
    { ...simple, ...advanced },
    { profileId: id, expectedVersionId: id },
    { ...advanced, quantities: { unknown: 'PRIVATE' } },
  ])(`keeps protected and ambiguous union errors generic during ${phase} (%#)`, (body) => {
    const value = fixture();
    const error = failure(() => call(value, bodyFor(body)));
    expect(error).not.toBeInstanceOf(InputFieldException);
    expect(error.getStatus()).toBe(400);
    noCalls(value);
  });
}
it.each([
  [{ ...address, provinceId: 'PRIVATE' }, ['provinceId']],
  [{ ...address, cityId: 'PRIVATE' }, ['cityId']],
  [{ ...address, fullAddress: '' }, ['fullAddress']],
  [{ ...address, postalCode: 'PRIVATE' }, ['postalCode']],
] as const)('owns nested delivery fields without exposing wire paths (%#)', (delivery, fields) => {
  const value = fixture();
  const body = {
    ...simple,
    address: delivery,
    idempotencyKey: next,
    expectedQuoteDigest: hash,
    responseNote: 'Updated terms',
  };
  const error = failure(() => value.customer.resubmitRevision(id, body, actor));
  expect(error).toBeInstanceOf(InputFieldException);
  expect((error as InputFieldException).fields).toEqual([...fields]);
  noCalls(value);
});
it('retains confirmed revision keys, digest and maximum normalized response note', () => {
  const value = fixture();
  const body = {
    ...simple,
    address,
    idempotencyKey: next,
    expectedQuoteDigest: hash,
    responseNote: `  ${'n'.repeat(1000)}  `,
  };
  value.customer.resubmitRevision(id, body, actor);
  expect(value.customerService.resubmitRevision).toHaveBeenCalledWith(
    actor.session,
    id,
    {
      ...body,
      address: { ...address, fullAddress: 'Corrected street' },
      responseNote: 'n'.repeat(1000),
    },
    actor.ip
  );
});

for (const action of ['request-changes', 'reject'] as const) {
  for (const confirmed of [false, true]) {
    const phase = confirmed ? 'confirm' : 'review';
    const base = confirmed
      ? { idempotencyKey: next, expectedVersionId: id, expectedReviewHash: hash }
      : { action };
    const call = (value: ReturnType<typeof fixture>, body: unknown, request = actor) =>
      !confirmed
        ? value.staff.financialReview(id, body, request)
        : action === 'reject'
          ? value.staff.reject(id, body, request)
          : value.staff.requestChanges(id, body, request);
    it.each([' ', null, 'PRIVATE'.repeat(143)])(
      `owns staff ${action} reason during ${phase} (%#)`,
      (reason) => {
        const value = fixture();
        const error = failure(() => call(value, { ...base, reason }));
        expect(error).toBeInstanceOf(InputFieldException);
        expect((error as InputFieldException).fields).toEqual(['reason']);
        noCalls(value);
      }
    );
    it(`withdraws reason feedback before ${action} ${phase} without live grants`, () => {
      const value = fixture();
      const denied = {
        ...actor,
        session: { ...actor.session, permissions: ['contracts:read'] },
      } as AuthenticatedRequest;
      const error = failure(() => call(value, { ...base, reason: ' ' }, denied));
      expect(error.getStatus()).toBe(403);
      expect(error).not.toBeInstanceOf(InputFieldException);
      noCalls(value);
    });
    it(`keeps mixed staff ${action} ${phase} errors generic`, () => {
      const value = fixture();
      const error = failure(() => call(value, { ...base, reason: ' ', extra: 'PRIVATE' }));
      expect(error).not.toBeInstanceOf(InputFieldException);
      noCalls(value);
    });
  }
}
it('keeps approval reason-free and missing decision reasons owned', () => {
  const value = fixture();
  for (const body of [
    { action: 'approve', reason: 'PRIVATE' },
    { action: 'PRIVATE', reason: '' },
  ]) {
    expect(failure(() => value.staff.financialReview(id, body, actor))).not.toBeInstanceOf(
      InputFieldException
    );
  }
  expect(
    failure(() => value.staff.financialReview(id, { action: 'request-changes' }, actor))
  ).toBeInstanceOf(InputFieldException);
  noCalls(value);
  value.staff.financialReview(id, { action: 'approve' }, actor);
  expect(value.staffService.financialReview).toHaveBeenCalledWith(id, 'approve', '', actor.session);
});
it('preserves maximum trimmed staff reason and exact financial bindings', () => {
  const value = fixture();
  const body = {
    reason: `  ${'n'.repeat(1000)}  `,
    idempotencyKey: next,
    expectedVersionId: id,
    expectedReviewHash: hash,
  };
  value.staff.requestChanges(id, body, actor);
  expect(value.staffService.decide).toHaveBeenCalledWith(
    id,
    'request-changes',
    { ...body, reason: 'n'.repeat(1000) },
    actor.session,
    actor.ip
  );
});
