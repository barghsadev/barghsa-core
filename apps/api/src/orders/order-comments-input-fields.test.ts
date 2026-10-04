import { HttpException, NotFoundException } from '@nestjs/common';
import { expect, it, vi } from 'vitest';
import { ErrorCodes } from '@barghsa/shared/errors';
import { InputFieldException } from '../common/input-field.exception.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import {
  ElectricityCommentsController,
  StaffElectricityCommentsController,
} from '../electricity/electricity-comments.controller.js';
import {
  SavingCommentsController,
  StaffSavingCommentsController,
} from '../saving/saving-comments.controller.js';

const id = '11111111-1111-4111-8111-111111111111';
const key = '22222222-2222-4222-8222-222222222222';
const request = {
  session: { userId: 'customer', sessionId: id, csrfToken: 'session-csrf' },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest;
const contexts = [
  { kind: 'electricity', staff: false, Controller: ElectricityCommentsController },
  { kind: 'electricity', staff: true, Controller: StaffElectricityCommentsController },
  { kind: 'saving', staff: false, Controller: SavingCommentsController },
  { kind: 'saving', staff: true, Controller: StaffSavingCommentsController },
] as const;
function fixture(context: (typeof contexts)[number]) {
  const receipt = {
    id: key,
    orderId: id,
    authorUserId: 'customer',
    authorName: 'Existing username',
    authorRole: 'customer',
    body: 'comment',
    createdAt: '2026-10-05T00:00:00.000Z',
    ...(context.kind === 'electricity' ? { visibility: 'public' } : {}),
  };
  const service = {
    assertCanAdd: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    add: vi.fn().mockResolvedValue(receipt),
    list: vi.fn().mockResolvedValue({ comments: [], nextBefore: null }),
  };
  const controller = new context.Controller(service as never);
  const body = {
    idempotencyKey: key,
    body: '  comment  ',
    ...(context.kind === 'electricity' && context.staff ? { visibility: 'public' } : {}),
  };
  return { service, controller, body, receipt };
}
async function failure(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) return error;
    throw error;
  }
  throw new Error('Expected rejected comment');
}

it.each(contexts)(
  'retains normalization, exact 10000 bound and the original receipt at $kind staff=$staff',
  async (context) => {
    const f = fixture(context);
    const body = 'x'.repeat(10000);
    expect(await f.controller.add(id, { ...f.body, body: ` ${body} ` }, request)).toBe(f.receipt);
    const normalized = {
      ...f.body,
      body,
      ...(context.kind === 'electricity' ? { visibility: 'public' } : {}),
    };
    expect(f.service.add).toHaveBeenCalledWith(
      id,
      request.session,
      context.staff,
      normalized,
      request.ip
    );
    expect(f.service.assertCanAdd).not.toHaveBeenCalled();
  }
);

it.each(contexts)(
  'projects body-only failures after the same live write authority at $kind staff=$staff',
  async (context) => {
    const f = fixture(context);
    for (const invalid of ['', '   ', 'x'.repeat(10001), null, undefined]) {
      const error = await failure(f.controller.add(id, { ...f.body, body: invalid }, request));
      expect(error).toBeInstanceOf(InputFieldException);
      expect((error as InputFieldException).fields).toEqual(['body']);
      expect(error.getResponse()).toEqual({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code });
    }
    expect(f.service.assertCanAdd).toHaveBeenCalledWith(id, request.session, context.staff);
    expect(f.service.add).not.toHaveBeenCalled();
  }
);

it.each(contexts)(
  'keeps protected, mixed, extra and root failures generic without new reads at $kind staff=$staff',
  async (context) => {
    const f = fixture(context);
    for (const invalid of [
      { ...f.body, idempotencyKey: 'PRIVATE' },
      { ...f.body, body: '', idempotencyKey: 'PRIVATE' },
      { ...f.body, body: '', extra: 'PRIVATE' },
      {
        ...f.body,
        idempotencyKey: 'PRIVATE',
        body: { private: 'PRIVATE' },
        visibility: 'PUBLIC-PRIVATE',
      },
      null,
      [],
      'PRIVATE',
    ]) {
      const error = await failure(f.controller.add(id, invalid, request));
      expect(error).not.toBeInstanceOf(InputFieldException);
      expect(error.getResponse()).toEqual({ error: 'VALIDATION:INPUT_INVALID' });
      expect(JSON.stringify(error.getResponse())).not.toContain('PRIVATE');
    }
    expect(f.service.add).not.toHaveBeenCalled();
    expect(f.service.assertCanAdd).not.toHaveBeenCalled();
  }
);

it.each(contexts)(
  'returns live session, permission or resource denial before owned feedback at $kind staff=$staff',
  async (context) => {
    const f = fixture(context);
    for (const denied of [
      new HttpException('Denied', 401),
      new HttpException('Denied', 403),
      new NotFoundException(),
    ]) {
      f.service.assertCanAdd.mockRejectedValueOnce(denied);
      expect(await failure(f.controller.add(id, { ...f.body, body: '' }, request))).toBe(denied);
    }
    expect(f.service.add).not.toHaveBeenCalled();
  }
);

it('owns staff electricity visibility and combined body errors while customer/saving visibility remains protected', async () => {
  const f = fixture(contexts[1]);
  for (const visibility of [undefined, 'PRIVATE', null]) {
    const error = await failure(f.controller.add(id, { ...f.body, visibility }, request));
    expect(error).toMatchObject({ fields: ['visibility'] });
  }
  const combined = await failure(
    f.controller.add(id, { ...f.body, body: '', visibility: '' }, request)
  );
  expect(combined).toMatchObject({ fields: ['body', 'visibility'] });
  for (const context of [contexts[0], contexts[2], contexts[3]]) {
    const other = fixture(context);
    const error = await failure(
      other.controller.add(id, { ...other.body, visibility: 'internal', body: '' }, request)
    );
    expect(error).not.toBeInstanceOf(InputFieldException);
    expect(other.service.assertCanAdd).not.toHaveBeenCalled();
  }
});

it('waits for the live write preflight before emitting owned metadata and preserves its final denial', async () => {
  const f = fixture(contexts[1]);
  let reject!: (error: unknown) => void;
  f.service.assertCanAdd.mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      })
  );
  const settled = vi.fn();
  const result = f.controller.add(id, { ...f.body, body: '' }, request).catch((error) => {
    settled();
    return error;
  });
  await Promise.resolve();
  expect(settled).not.toHaveBeenCalled();
  expect(f.service.add).not.toHaveBeenCalled();
  const denied = new HttpException('Session no longer current', 401);
  reject(denied);
  expect(await result).toBe(denied);
});

it('preserves the existing visible-cursor list parser without introducing editable query fields', () => {
  for (const context of contexts) {
    const f = fixture(context);
    f.controller.list(id, { before: key }, request);
    expect(f.service.list).toHaveBeenCalledWith(id, request.session, context.staff, key);
    expect(() => f.controller.list(id, { before: 'PRIVATE' }, request)).toThrow(HttpException);
    expect(f.service.assertCanAdd).not.toHaveBeenCalled();
  }
});
