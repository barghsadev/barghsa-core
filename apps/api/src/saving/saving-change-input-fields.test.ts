import { HttpException, NotFoundException } from '@nestjs/common';
import { expect, it, vi } from 'vitest';
import { InputFieldException } from '../common/input-field.exception.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { SavingOrderController } from './saving-order.controller.js';
import { SavingFulfillmentController } from './saving-fulfillment.controller.js';

const id = '11111111-1111-4111-8111-111111111111';
const addressId = '22222222-2222-4222-8222-222222222222';
const request = {
  session: { userId: 'staff', sessionId: id, csrfToken: 'csrf', permissions: ['contracts:write'] },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest;
const contexts = [
  { name: 'customer quote', staff: false, write: false },
  { name: 'customer change', staff: false, write: true },
  { name: 'staff review', staff: true, write: false },
  { name: 'staff amendment', staff: true, write: true },
] as const;
function fixture(context: (typeof contexts)[number]) {
  const authorize = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const work = vi.fn().mockResolvedValue({ original: 'receipt' });
  const service = {
    assertCanChange: authorize,
    assertCanAmendAddress: authorize,
    quoteChange: work,
    change: work,
    addressAmendmentReview: work,
    amendAddress: work,
  };
  const customer = new SavingOrderController(service as never, {} as never);
  const staff = new SavingFulfillmentController(service as never);
  const invoke = (body: unknown, req = request) =>
    context.staff
      ? context.write
        ? staff.amendAddress(id, body, req)
        : staff.amendAddressReview(id, body, req)
      : context.write
        ? customer.change(id, body, req)
        : customer.quoteChange(id, body, req);
  const body = context.staff
    ? {
        expectedVersionId: id,
        expectedAddressId: id,
        addressId,
        reason: '  confirmed address  ',
        ...(context.write ? { idempotencyKey: id, expectedReviewHash: 'a'.repeat(64) } : {}),
      }
    : {
        hardwareProductId: id,
        installationAddressId: addressId,
        ...(context.write ? { idempotencyKey: id, expectedQuoteDigest: 'a'.repeat(64) } : {}),
      };
  return { invoke, body, authorize, work };
}
async function failure(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) return error;
    throw error;
  }
  throw new Error('Expected rejected input');
}
it.each(contexts)(
  'preserves exact successful service input and receipt at $name',
  async (context) => {
    const f = fixture(context);
    expect(await f.invoke(f.body)).toEqual({ original: 'receipt' });
    const normalized = context.staff ? { ...f.body, reason: 'confirmed address' } : f.body;
    expect(f.work).toHaveBeenCalledWith(
      ...(context.staff ? [id, normalized, request.session] : [request.session, id, normalized]),
      ...(context.write ? [request.ip] : [])
    );
    expect(f.authorize).not.toHaveBeenCalled();
  }
);
it.each(contexts)(
  'projects only owned fields after current authority at $name',
  async (context) => {
    const f = fixture(context);
    const fields = context.staff
      ? ['addressId', 'reason']
      : ['hardwareProductId', 'installationAddressId'];
    for (const field of fields) {
      for (const invalid of [
        undefined,
        null,
        '',
        field === 'reason' ? 'x'.repeat(1001) : 'PRIVATE',
        { PRIVATE: true },
      ]) {
        const error = await failure(f.invoke({ ...f.body, [field]: invalid }));
        expect(error).toBeInstanceOf(InputFieldException);
        expect(error).toMatchObject({ fields: [field] });
        expect(error.getResponse()).toEqual({ error: 'VALIDATION:INPUT:INVALID' });
      }
    }
    const both = await failure(f.invoke({ ...f.body, [fields[0]!]: '', [fields[1]!]: '' }));
    expect(both).toMatchObject({ fields });
    expect(f.authorize).toHaveBeenCalledWith(
      ...(context.staff ? [id, request.session, context.write] : [request.session, id])
    );
    expect(f.work).not.toHaveBeenCalled();
  }
);
it.each(contexts)(
  'keeps protected, mixed, extra and root errors generic at $name',
  async (context) => {
    const f = fixture(context);
    const owned = context.staff ? 'reason' : 'hardwareProductId';
    const protectedField = context.staff
      ? 'expectedVersionId'
      : context.write
        ? 'expectedQuoteDigest'
        : 'idempotencyKey';
    for (const body of [
      { ...f.body, [protectedField]: 'PRIVATE' },
      { ...f.body, [owned]: '', [protectedField]: 'PRIVATE' },
      { ...f.body, [owned]: '', extra: 'PRIVATE' },
      { ...f.body, extra: 'PRIVATE' },
      null,
      [],
      'PRIVATE',
      ...(context.write ? [{ ...f.body, [owned]: '', idempotencyKey: 'PRIVATE' }] : []),
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
  'returns resource and live authority denial before field feedback at $name',
  async (context) => {
    const f = fixture(context);
    for (const denied of [
      new HttpException('Expired', 401),
      new HttpException('Denied', 403),
      new NotFoundException(),
    ]) {
      f.authorize.mockRejectedValueOnce(denied);
      expect(
        await failure(f.invoke({ ...f.body, [context.staff ? 'reason' : 'hardwareProductId']: '' }))
      ).toBe(denied);
    }
    expect(f.work).not.toHaveBeenCalled();
  }
);
it.each(contexts.filter((context) => context.staff))(
  'retains normalized 1000/1001 reason boundary at $name',
  async (context) => {
    const f = fixture(context);
    await f.invoke({ ...f.body, reason: ` ${'x'.repeat(1000)} ` });
    expect(f.work.mock.calls[0]?.[1]).toMatchObject({ reason: 'x'.repeat(1000) });
    expect(await failure(f.invoke({ ...f.body, reason: 'x'.repeat(1001) }))).toMatchObject({
      fields: ['reason'],
    });
  }
);
it.each(contexts.filter((context) => context.staff))(
  'requires contracts write before parsing at $name',
  async (context) => {
    const f = fixture(context);
    const denied = {
      ...request,
      session: { ...request.session, permissions: ['contracts:read'] },
    } as unknown as AuthenticatedRequest;
    expect(await failure(f.invoke({ ...f.body, reason: '' }, denied))).toMatchObject({
      status: 403,
    });
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.work).not.toHaveBeenCalled();
  }
);
it('waits for final preflight authority before projecting any field', async () => {
  const f = fixture(contexts[3]);
  let reject!: (reason: unknown) => void;
  f.authorize.mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      })
  );
  const settled = vi.fn();
  const pending = f.invoke({ ...f.body, reason: '' }).catch((error) => {
    settled();
    return error;
  });
  await Promise.resolve();
  expect(settled).not.toHaveBeenCalled();
  const denied = new HttpException('No longer current', 401);
  reject(denied);
  expect(await pending).toBe(denied);
  expect(f.work).not.toHaveBeenCalled();
});
