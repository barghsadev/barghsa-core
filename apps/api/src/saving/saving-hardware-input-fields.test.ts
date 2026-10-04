import { HttpException, NotFoundException } from '@nestjs/common';
import { expect, it, vi } from 'vitest';
import { InputFieldException } from '../common/input-field.exception.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { SavingFulfillmentController } from './saving-fulfillment.controller.js';

const id = '11111111-1111-4111-8111-111111111111';
const target = '22222222-2222-4222-8222-222222222222';
const request = {
  session: {
    userId: 'staff',
    sessionId: id,
    csrfToken: 'csrf',
    permissions: ['contracts:write', 'invoices:write'],
  },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest;
const contexts = [
  { name: 'hardware preview', cancel: false, write: false },
  { name: 'hardware mutation', cancel: false, write: true },
  { name: 'cancellation preview', cancel: true, write: false },
  { name: 'cancellation mutation', cancel: true, write: true },
] as const;
function fixture(context: (typeof contexts)[number]) {
  const authorize = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const work = vi.fn().mockResolvedValue({ original: 'stored receipt' });
  const service = {
    assertCanAmendHardware: authorize,
    assertCanCancelHardwareUpgrade: authorize,
    hardwareAmendmentReview: work,
    amendHardware: work,
    hardwareUpgradeCancellationReview: work,
    cancelHardwareUpgrade: work,
  };
  const controller = new SavingFulfillmentController(service as never);
  const invoke = (body: unknown, req = request) =>
    context.cancel
      ? context.write
        ? controller.cancelHardwareUpgrade(id, body, req)
        : controller.cancelHardwareUpgradeReview(id, body, req)
      : context.write
        ? controller.amendHardware(id, body, req)
        : controller.amendHardwareReview(id, body, req);
  const body = {
    ...(context.cancel
      ? { upgradeId: target }
      : { expectedVersionId: id, expectedHardwareId: id, hardwareProductId: target }),
    reason: '  Customer requested the change  ',
    ...(context.write ? { idempotencyKey: id, expectedReviewHash: 'a'.repeat(64) } : {}),
  };
  return { body, invoke, work, authorize };
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
  'preserves normalized exact service input and original receipt at $name',
  async (context) => {
    const f = fixture(context);
    expect(await f.invoke(f.body)).toEqual({ original: 'stored receipt' });
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.work).toHaveBeenCalledWith(
      id,
      { ...f.body, reason: 'Customer requested the change' },
      request.session,
      ...(context.write ? [request.ip] : []),
      ...(context.cancel ? [] : [true])
    );
  }
);
it.each(contexts)(
  'projects only editable paths after same-resource authority at $name',
  async (context) => {
    const f = fixture(context);
    const fields = context.cancel ? ['reason'] : ['hardwareProductId', 'reason'];
    for (const field of fields)
      for (const invalid of [
        undefined,
        null,
        '',
        field === 'reason' ? 'x'.repeat(1001) : 'PRIVATE',
        { PRIVATE: true },
      ]) {
        const body = { ...f.body, [field]: invalid };
        const error = await failure(f.invoke(body));
        expect(error).toBeInstanceOf(InputFieldException);
        expect(error).toMatchObject({ fields: [field] });
        expect(error.getResponse()).toEqual({ error: 'VALIDATION:INPUT:INVALID' });
        expect(f.authorize).toHaveBeenLastCalledWith(
          id,
          request.session,
          context.write,
          body,
          ...(context.cancel ? [] : [true])
        );
      }
    if (!context.cancel)
      expect(
        await failure(f.invoke({ ...f.body, hardwareProductId: '', reason: '' }))
      ).toMatchObject({ fields });
    expect(f.work).not.toHaveBeenCalled();
  }
);
it.each(contexts)(
  'keeps protected, mixed, unknown and root input generic at $name',
  async (context) => {
    const f = fixture(context);
    const protectedFields = context.cancel
      ? ['upgradeId']
      : ['expectedVersionId', 'expectedHardwareId'];
    if (context.write) protectedFields.push('idempotencyKey', 'expectedReviewHash');
    for (const body of [
      ...protectedFields.flatMap((field) => [
        { ...f.body, [field]: 'PRIVATE' },
        { ...f.body, [field]: 'PRIVATE', reason: '' },
      ]),
      { ...f.body, reason: '', unknown: 'PRIVATE' },
      { ...f.body, unknown: 'PRIVATE' },
      null,
      [],
      'PRIVATE',
    ]) {
      const error = await failure(f.invoke(body));
      expect(error).not.toBeInstanceOf(InputFieldException);
      expect(error.getResponse()).toEqual({ error: 'VALIDATION:INPUT_INVALID' });
    }
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.work).not.toHaveBeenCalled();
  }
);
it.each(contexts)(
  'returns current session, grant and resource denial before field feedback at $name',
  async (context) => {
    const f = fixture(context);
    for (const error of [
      new HttpException('Expired', 401),
      new HttpException('Revoked', 403),
      new NotFoundException(),
    ]) {
      f.authorize.mockRejectedValueOnce(error);
      expect(await failure(f.invoke({ ...f.body, reason: '' }))).toBe(error);
    }
    expect(f.work).not.toHaveBeenCalled();
  }
);
it.each(contexts)('preserves the trimmed reason1000/1001 boundary at $name', async (context) => {
  const f = fixture(context);
  await f.invoke({ ...f.body, reason: ` ${'x'.repeat(1000)} ` });
  expect(f.work.mock.calls[0]?.[1]).toMatchObject({ reason: 'x'.repeat(1000) });
  expect(await failure(f.invoke({ ...f.body, reason: 'x'.repeat(1001) }))).toMatchObject({
    fields: ['reason'],
  });
});
it.each(contexts)('requires contract write before any parsing at $name', async (context) => {
  const f = fixture(context);
  const req = {
    ...request,
    session: { ...request.session, permissions: ['contracts:read', 'invoices:write'] },
  } as unknown as AuthenticatedRequest;
  expect(await failure(f.invoke({ ...f.body, reason: '' }, req))).toMatchObject({ status: 403 });
  expect(f.authorize).not.toHaveBeenCalled();
  expect(f.work).not.toHaveBeenCalled();
});
it.each(contexts)(
  'keeps contract-only equal-price authority separate from mandatory cancellation finance at $name',
  async (context) => {
    const f = fixture(context);
    const req = {
      ...request,
      session: { ...request.session, permissions: ['contracts:write'] },
    } as unknown as AuthenticatedRequest;
    const body = { ...f.body, reason: '' };
    const error = await failure(f.invoke(body, req));
    if (context.cancel) {
      expect(error).toMatchObject({ status: 403 });
      expect(f.authorize).not.toHaveBeenCalled();
    } else {
      expect(error).toBeInstanceOf(InputFieldException);
      expect(f.authorize).toHaveBeenCalledWith(id, req.session, context.write, body, false);
    }
    expect(f.work).not.toHaveBeenCalled();
  }
);
