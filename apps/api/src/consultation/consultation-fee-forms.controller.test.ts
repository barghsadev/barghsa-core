import { HttpException } from '@nestjs/common';
import { expect, it, vi } from 'vitest';
import { InputFieldException } from '../common/input-field.exception.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { StaffConsultationWorkflowController } from './consultation-workflow.controller.js';

const id = '11111111-1111-4111-8111-111111111111';
const req = {
  session: {
    userId: 'opaque-staff',
    permissions: ['orders:write', 'invoices:write', 'admin:financial:edit'],
  },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest;
const contexts = [
  { name: 'offer preview', paid: false, write: false },
  { name: 'offer write', paid: false, write: true },
  { name: 'paid preview', paid: true, write: false },
  { name: 'paid write', paid: true, write: true },
] as const;
function fixture(context: (typeof contexts)[number]) {
  const authorize = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const work = vi.fn().mockResolvedValue({ original: 'durable full receipt' });
  const controller = new StaffConsultationWorkflowController({
    assertCanEditFee: authorize,
    setFee: work,
    feeReview: work,
    adjustPaidFee: work,
    paidFeeReview: work,
  } as never);
  const body = {
    fee: '500000',
    validUntil: '2050-01-01T12:34:56+03:00',
    reason: '  Exact reason  ',
    ...(context.paid ? {} : { scope: '  Exact scope  ', deliverables: '  Exact deliverables  ' }),
    ...(context.write ? { idempotencyKey: id, expectedReviewHash: 'a'.repeat(64) } : {}),
  };
  const invoke = (input: unknown, request = req) =>
    context.paid
      ? context.write
        ? controller.adjustPaidFee(id, input, request)
        : controller.paidFeeReview(id, input, request)
      : context.write
        ? controller.setFee(id, input, request)
        : controller.feeReview(id, input, request);
  return { authorize, work, body, invoke };
}
async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) return error;
    throw error;
  }
  throw new Error('Expected invalid input');
}
it.each(contexts)(
  'retains exact normalized command, original offset and saved receipt without preflight at $name',
  async (context) => {
    const f = fixture(context);
    expect(await f.invoke(f.body)).toEqual({ original: 'durable full receipt' });
    expect(f.work).toHaveBeenCalledWith(
      req.session,
      id,
      {
        ...f.body,
        reason: 'Exact reason',
        ...(context.paid ? {} : { scope: 'Exact scope', deliverables: 'Exact deliverables' }),
      },
      ...(context.write ? [req.ip] : [])
    );
    expect(f.authorize).not.toHaveBeenCalled();
  }
);
it.each(contexts)(
  'projects owned-only syntax/range/bounds after live resource authority at $name',
  async (context) => {
    const f = fixture(context);
    const fields = context.paid
      ? ['fee', 'validUntil', 'reason']
      : ['fee', 'scope', 'deliverables', 'validUntil', 'reason'];
    for (const field of fields)
      for (const value of [
        null,
        '',
        { PRIVATE: true },
        field === 'fee'
          ? '9223372036854775808'
          : field === 'validUntil'
            ? 'PRIVATE'
            : 'x'.repeat(field === 'reason' ? (context.paid ? 1001 : 2001) : 4001),
      ]) {
        const error = await failure(f.invoke({ ...f.body, [field]: value }));
        expect(error).toBeInstanceOf(InputFieldException);
        expect(error).toMatchObject({ fields: [field] });
        expect(JSON.stringify(error.getResponse())).not.toContain('PRIVATE');
        expect(f.authorize).toHaveBeenLastCalledWith(req.session, id, context.paid, context.write);
      }
    for (const fee of ['0', '-1', '01', '1.2', '۱'])
      expect(await failure(f.invoke({ ...f.body, fee }))).toMatchObject({ fields: ['fee'] });
    expect(await failure(f.invoke({ ...f.body, fee: '0', validUntil: 'PRIVATE' }))).toMatchObject({
      fields: context.paid ? ['fee', 'validUntil'] : ['fee', 'validUntil'],
    });
    expect(f.work).not.toHaveBeenCalled();
  }
);
it.each(contexts)(
  'keeps key/hash, unknown, root and mixed failures generic at $name',
  async (context) => {
    const f = fixture(context);
    for (const body of [
      null,
      [],
      'PRIVATE',
      { ...f.body, unknown: 'PRIVATE' },
      { ...f.body, fee: '0', unknown: 'PRIVATE' },
      ...(context.write
        ? [
            { ...f.body, idempotencyKey: 'PRIVATE' },
            { ...f.body, expectedReviewHash: 'PRIVATE', reason: '' },
          ]
        : [{ ...f.body, idempotencyKey: id, fee: '0' }]),
    ]) {
      const error = await failure(f.invoke(body));
      expect(error.getStatus()).toBe(400);
      expect(error).not.toBeInstanceOf(InputFieldException);
      expect(JSON.stringify(error.getResponse())).not.toMatch(/PRIVATE|fields/);
    }
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.work).not.toHaveBeenCalled();
  }
);
it.each(contexts)(
  'preserves current grant, session, step-up and missing-resource denial before owned feedback at $name',
  async (context) => {
    const f = fixture(context);
    for (const status of [401, 403, 404]) {
      const denied = new HttpException('Current authority', status);
      f.authorize.mockRejectedValueOnce(denied);
      expect(await failure(f.invoke({ ...f.body, fee: '0' }))).toBe(denied);
    }
    expect(f.work).not.toHaveBeenCalled();
  }
);
it.each(contexts)(
  'accepts PG maximum, text/reason boundaries and syntactically expired commands for stored replay at $name',
  async (context) => {
    const f = fixture(context);
    const body = {
      ...f.body,
      fee: '9223372036854775807',
      validUntil: '2020-01-01T12:34:56+03:00',
      reason: 'x'.repeat(context.paid ? 1000 : 2000),
      ...(context.paid ? {} : { scope: 's'.repeat(4000), deliverables: 'd'.repeat(4000) }),
    };
    await f.invoke(body);
    expect(f.work).toHaveBeenCalledWith(req.session, id, body, ...(context.write ? [req.ip] : []));
    expect(f.authorize).not.toHaveBeenCalled();
  }
);
it.each(contexts)('requires cached orders write before parsing at $name', async (context) => {
  const f = fixture(context);
  const request = {
    ...req,
    session: { ...req.session, permissions: ['invoices:write', 'admin:financial:edit'] },
  } as unknown as AuthenticatedRequest;
  expect(await failure(f.invoke({ ...f.body, fee: '0' }, request))).toMatchObject({ status: 403 });
  expect(f.authorize).not.toHaveBeenCalled();
  expect(f.work).not.toHaveBeenCalled();
});
it('retains optional ordinary reason and required paid reason without new command properties', async () => {
  for (const context of contexts) {
    const f = fixture(context);
    const { reason: _reason, ...body } = f.body;
    if (context.paid) expect(await failure(f.invoke(body))).toMatchObject({ fields: ['reason'] });
    else {
      await f.invoke(body);
      expect(f.work.mock.lastCall?.[2]).not.toHaveProperty('reason');
    }
  }
});
