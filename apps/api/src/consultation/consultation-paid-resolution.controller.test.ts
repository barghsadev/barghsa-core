import { HttpException } from '@nestjs/common';
import { expect, it, vi } from 'vitest';
import { InputFieldException } from '../common/input-field.exception.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { StaffConsultationWorkflowController } from './consultation-workflow.controller.js';

const id = '11111111-1111-4111-8111-111111111111';
const req = {
  session: { userId: 'opaque-staff', permissions: ['orders:write'] },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest;
const contexts = [
  { action: 'cancel', write: false },
  { action: 'reject', write: false },
  { action: 'recover_refund', write: false },
  { action: 'cancel', write: true },
  { action: 'reject', write: true },
  { action: 'recover_refund', write: true },
] as const;
function fixture(context: (typeof contexts)[number]) {
  const authorize = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const work = vi.fn().mockResolvedValue({ original: 'saved financial receipt' });
  const controller = new StaffConsultationWorkflowController({
    assertCanEditPaidResolution: authorize,
    paidResolutionReview: work,
    closePaid: work,
    recoverRefund: work,
  } as never);
  const body = context.write
    ? { idempotencyKey: id, reason: '  Exact reason  ', expectedReviewHash: 'a'.repeat(64) }
    : { action: context.action, reason: '  Exact reason  ' };
  const invoke = (value: unknown, request = req) =>
    !context.write
      ? controller.paidResolutionReview(id, value, request)
      : context.action === 'cancel'
        ? controller.paidCancel(id, value, request)
        : context.action === 'reject'
          ? controller.paidReject(id, value, request)
          : controller.refundRecovery(id, value, request);
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
  'preserves normalized valid $action/$write commands and saved results',
  async (context) => {
    const f = fixture(context);
    for (const reason of ['  Exact reason  ', 'x'.repeat(1000)]) {
      expect(await f.invoke({ ...f.body, reason })).toEqual({
        original: 'saved financial receipt',
      });
      expect(f.work).toHaveBeenLastCalledWith(
        req.session,
        id,
        ...(context.write && context.action !== 'recover_refund' ? [context.action] : []),
        { ...f.body, reason: reason.trim() },
        ...(context.write ? [req.ip] : [])
      );
    }
    expect(f.authorize).not.toHaveBeenCalled();
  }
);
it.each(contexts)(
  'projects only reason after current authority at $action/$write',
  async (context) => {
    const f = fixture(context);
    for (const reason of [
      undefined,
      null,
      '',
      '  ',
      ['PRIVATE'],
      { PRIVATE: true },
      'x'.repeat(1001),
    ]) {
      const error = await failure(f.invoke({ ...f.body, reason }));
      expect(error).toBeInstanceOf(InputFieldException);
      expect(error).toMatchObject({ fields: ['reason'] });
      expect(JSON.stringify(error.getResponse())).not.toContain('PRIVATE');
      expect(f.authorize).toHaveBeenLastCalledWith(
        req.session,
        id,
        context.action === 'recover_refund',
        context.write
      );
    }
    expect(f.work).not.toHaveBeenCalled();
  }
);
it.each(contexts)(
  'keeps protected, root, unknown and mixed $action/$write errors generic',
  async (context) => {
    const f = fixture(context);
    for (const body of [
      null,
      [],
      'PRIVATE',
      { ...f.body, unknown: 'PRIVATE' },
      { ...f.body, reason: '', unknown: 'PRIVATE' },
      ...(context.write
        ? [
            { ...f.body, idempotencyKey: 'PRIVATE' },
            { ...f.body, reason: '', expectedReviewHash: 'PRIVATE' },
            { ...f.body, action: 'PRIVATE' },
          ]
        : [
            { ...f.body, action: 'PRIVATE', reason: '' },
            { ...f.body, expectedReviewHash: 'PRIVATE' },
          ]),
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
  'preserves current denial before reason feedback at $action/$write',
  async (context) => {
    const f = fixture(context);
    for (const status of [401, 403, 404]) {
      const denied = new HttpException('Current authority', status);
      f.authorize.mockRejectedValueOnce(denied);
      expect(await failure(f.invoke({ ...f.body, reason: '' }))).toBe(denied);
    }
    expect(f.work).not.toHaveBeenCalled();
  }
);
it.each(contexts)(
  'checks cached orders permission before parsing $action/$write',
  async (context) => {
    const f = fixture(context);
    const denied = {
      session: { ...req.session, permissions: [] },
      ip: req.ip,
    } as unknown as AuthenticatedRequest;
    for (const body of [f.body, { ...f.body, reason: '' }, null])
      expect((await failure(f.invoke(body, denied))).getStatus()).toBe(403);
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.work).not.toHaveBeenCalled();
  }
);
