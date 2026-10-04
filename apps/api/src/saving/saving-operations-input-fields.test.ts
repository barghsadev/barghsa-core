import { HttpException, NotFoundException } from '@nestjs/common';
import { expect, it, vi } from 'vitest';
import { InputFieldException } from '../common/input-field.exception.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { SavingFulfillmentController } from './saving-fulfillment.controller.js';

const id = '11111111-1111-4111-8111-111111111111';
const request = {
  session: {
    userId: 'opaque-staff',
    sessionId: id,
    csrfToken: 'csrf',
    permissions: ['contracts:write'],
  },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest;
const contexts = [
  { name: 'rejection preview', fulfillment: false, write: false },
  { name: 'rejection mutation', fulfillment: false, write: true },
  { name: 'stage preview', fulfillment: true, write: false },
  { name: 'stage mutation', fulfillment: true, write: true },
] as const;
function fixture(context: (typeof contexts)[number]) {
  const authorize = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const work = vi.fn().mockResolvedValue({ original: 'stored receipt' });
  const controller = new SavingFulfillmentController({
    assertCanDecideOrAdvance: authorize,
    decisionReview: work,
    decide: work,
    advanceReview: work,
    advance: work,
  } as never);
  const invoke = (
    body: unknown,
    req = request,
    stage = 'equipment_handover',
    action = 'complete'
  ) =>
    context.fulfillment
      ? context.write
        ? controller.advance(id, stage, action, body, req)
        : controller.advanceReview(id, stage, action, body, req)
      : context.write
        ? controller.reject(id, body, req)
        : controller.financialReview(id, body, req);
  const body = {
    ...(context.fulfillment
      ? {
          expectedStatus: 'in_progress',
          explanation: '  Staff verified progress  ',
          handoverDescription: '  Equipment accepted  ',
        }
      : context.write
        ? { expectedVersionId: id, reason: '  Request unavailable  ' }
        : { action: 'reject', reason: '  Request unavailable  ' }),
    ...(context.write ? { idempotencyKey: id, expectedReviewHash: 'a'.repeat(64) } : {}),
  };
  return { body, invoke, work, authorize, controller };
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
  'preserves original normalized input, full receipt and contract-only authority at $name',
  async (context) => {
    const f = fixture(context);
    expect(await f.invoke(f.body)).toEqual({ original: 'stored receipt' });
    expect(f.authorize).not.toHaveBeenCalled();
    const normalized = context.fulfillment
      ? {
          ...f.body,
          explanation: 'Staff verified progress',
          handoverDescription: 'Equipment accepted',
        }
      : { ...f.body, reason: 'Request unavailable' };
    expect(f.work).toHaveBeenCalledWith(
      id,
      ...(context.fulfillment
        ? ['equipment_handover', 'complete', normalized]
        : ['reject', context.write ? normalized : 'Request unavailable']),
      request.session,
      ...(context.write ? [request.ip] : [])
    );
  }
);
it.each(contexts)(
  'projects only owned malformed/bounded input after current same-resource authority at $name',
  async (context) => {
    const f = fixture(context);
    const fields = context.fulfillment ? ['explanation', 'handoverDescription'] : ['reason'];
    for (const field of fields)
      for (const invalid of [null, '', '   ', 'x'.repeat(1001), { PRIVATE: true }]) {
        const body = { ...f.body, [field]: invalid };
        const error = await failure(f.invoke(body));
        expect(error).toBeInstanceOf(InputFieldException);
        expect(error).toMatchObject({ fields: [field] });
        expect(error.getResponse()).toEqual({ error: 'VALIDATION:INPUT:INVALID' });
        expect(f.authorize).toHaveBeenLastCalledWith(
          id,
          request.session,
          context.write,
          context.fulfillment
        );
      }
    const missing = { ...f.body, [fields[0]!]: undefined };
    expect(await failure(f.invoke(missing))).toMatchObject({ fields: [fields[0]] });
    if (context.fulfillment)
      expect(
        await failure(f.invoke({ ...f.body, explanation: '', handoverDescription: '' }))
      ).toMatchObject({ fields });
    expect(f.work).not.toHaveBeenCalled();
  }
);
it.each(contexts)(
  'keeps protected, mixed, unknown, root and fixed route failures generic at $name',
  async (context) => {
    const f = fixture(context);
    const field = context.fulfillment ? 'explanation' : 'reason';
    const protectedFields = context.fulfillment
      ? ['expectedStatus']
      : context.write
        ? ['expectedVersionId']
        : ['action'];
    if (context.write) protectedFields.push('idempotencyKey', 'expectedReviewHash');
    for (const body of [
      ...protectedFields.flatMap((key) => [
        { ...f.body, [key]: 'PRIVATE' },
        { ...f.body, [key]: 'PRIVATE', [field]: '' },
      ]),
      { ...f.body, unknown: 'PRIVATE' },
      { ...f.body, unknown: 'PRIVATE', [field]: '' },
      null,
      [],
      'PRIVATE',
    ]) {
      const error = await failure(f.invoke(body));
      expect(error).not.toBeInstanceOf(InputFieldException);
      expect(error.getResponse()).toEqual({ error: 'VALIDATION:INPUT_INVALID' });
    }
    if (context.fulfillment)
      for (const [stage, action] of [
        ['PRIVATE', 'complete'],
        ['equipment_handover', 'PRIVATE'],
      ])
        expect(
          (
            await failure(f.invoke({ ...f.body, explanation: '' }, request, stage, action))
          ).getResponse()
        ).toEqual({ error: 'VALIDATION:INPUT_INVALID' });
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.work).not.toHaveBeenCalled();
  }
);
it.each(contexts)(
  'returns current session, permission and missing-resource denial before feedback at $name',
  async (context) => {
    const f = fixture(context);
    for (const error of [
      new HttpException('Current session', 401),
      new HttpException('Current permission', 403),
      new NotFoundException(),
    ]) {
      f.authorize.mockRejectedValueOnce(error);
      expect(
        await failure(f.invoke({ ...f.body, [context.fulfillment ? 'explanation' : 'reason']: '' }))
      ).toBe(error);
    }
    expect(f.work).not.toHaveBeenCalled();
  }
);
it.each(contexts)('preserves trimmed 1000/1001 input boundaries at $name', async (context) => {
  const f = fixture(context);
  for (const field of context.fulfillment ? ['explanation', 'handoverDescription'] : ['reason']) {
    await f.invoke({ ...f.body, [field]: ` ${'x'.repeat(1000)} ` });
    if (context.fulfillment || context.write)
      expect(f.work.mock.lastCall?.[context.fulfillment ? 3 : 2]).toMatchObject({
        [field]: 'x'.repeat(1000),
      });
    else expect(f.work.mock.lastCall?.[2]).toBe('x'.repeat(1000));
    expect(await failure(f.invoke({ ...f.body, [field]: 'x'.repeat(1001) }))).toMatchObject({
      fields: [field],
    });
  }
});
it.each(contexts)('requires contracts write before parsing at $name', async (context) => {
  const f = fixture(context);
  const req = {
    ...request,
    session: { ...request.session, permissions: ['contracts:read', 'invoices:write'] },
  } as unknown as AuthenticatedRequest;
  expect(
    await failure(
      f.invoke({ ...f.body, [context.fulfillment ? 'explanation' : 'reason']: '' }, req)
    )
  ).toMatchObject({ status: 403 });
  expect(f.authorize).not.toHaveBeenCalled();
  expect(f.work).not.toHaveBeenCalled();
});
it('preserves protected-only approval and keeps approval/unknown-intent reason failures generic', async () => {
  const f = fixture(contexts[0]);
  expect(await f.controller.financialReview(id, { action: 'approve' }, request)).toEqual({
    original: 'stored receipt',
  });
  expect(f.work).toHaveBeenLastCalledWith(id, 'approve', '', request.session);
  const body = { idempotencyKey: id, expectedVersionId: id, expectedReviewHash: 'a'.repeat(64) };
  expect(await f.controller.approve(id, body, request)).toEqual({ original: 'stored receipt' });
  expect(f.work).toHaveBeenLastCalledWith(id, 'approve', body, request.session, request.ip);
  for (const preview of [
    { action: 'approve', reason: 'PRIVATE' },
    { reason: '' },
    { action: 'PRIVATE', reason: '' },
  ])
    expect(
      (await failure(f.controller.financialReview(id, preview, request))).getResponse()
    ).toEqual({ error: 'VALIDATION:INPUT_INVALID' });
  expect(() => f.controller.approve(id, { ...body, reason: '' }, request)).toThrow(HttpException);
  expect(f.authorize).not.toHaveBeenCalled();
});
it.each([contexts[2], contexts[3]])(
  'preserves optional handover omission/inclusion and lets the engine enforce completion at $name',
  async (context) => {
    const f = fixture(context);
    if (!('handoverDescription' in f.body)) throw new Error('Expected a stage fixture');
    const { handoverDescription: _description, ...without } = f.body;
    await f.invoke(without, request, 'equipment_handover', 'skip');
    expect(f.work.mock.lastCall?.[3]).not.toHaveProperty('handoverDescription');
    await f.invoke(f.body, request, 'equipment_handover', 'skip');
    expect(f.work.mock.lastCall?.[3]).toHaveProperty('handoverDescription', 'Equipment accepted');
    const conflict = new HttpException('Existing completion prerequisite', 409);
    f.work.mockRejectedValueOnce(conflict);
    expect(await failure(f.invoke(without))).toBe(conflict);
    expect(f.authorize).not.toHaveBeenCalled();
  }
);
