import { randomUUID } from 'node:crypto';
import { HttpException, NotFoundException } from '@nestjs/common';
import { expect, it, vi } from 'vitest';
import { ErrorCodes } from '@barghsa/shared/errors';
import { InputFieldException } from '../common/input-field.exception.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { ContractCancellationController } from './contract-cancellation.controller.js';
import {
  CustomerCancellationRequestController,
  StaffCancellationRequestController,
} from './contract-cancellation-request.controller.js';
import { cancellationInputFields } from './contract-cancellation-input-fields.js';
const id = randomUUID(),
  version = randomUUID();
const staff = {
  session: { isAdmin: true, userId: 'staff' },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest;
const denied = {
  session: { isAdmin: false, userId: 'staff' },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest;
const request = () => ({
  expectedVersionId: version,
  reason: '  End service  ',
  preferredDestination: 'wallet',
  idempotencyKey: randomUUID(),
});
const decision = () => ({
  expectedVersionId: version,
  expectedFingerprint: 'a'.repeat(64),
  reason: 'End service',
  refundDecision: {
    mode: 'custom',
    refunds: [{ invoiceId: id, amount: '100', destination: 'wallet' }],
  },
  idempotencyKey: randomUUID(),
});
function service() {
  return {
    assertRequestAccess: vi.fn().mockResolvedValue(undefined),
    submit: vi.fn(),
    reject: vi.fn(),
    prepare: vi.fn(),
    execute: vi.fn(),
  };
}
function thrown(work: () => unknown): HttpException {
  try {
    work();
  } catch (e) {
    if (e instanceof HttpException) return e;
    throw e;
  }
  throw new Error('Expected rejection');
}
it.each(['', ' ', 'x'.repeat(1001)])(
  'reports an owned customer reason error after live access verification (%s)',
  async (reason) => {
    const s = service(),
      c = new CustomerCancellationRequestController(s as never);
    const error = await c.submit(staff, id, { ...request(), reason }).catch((e) => e);
    expect(error).toBeInstanceOf(InputFieldException);
    expect(error.fields).toEqual(['reason']);
    expect(s.assertRequestAccess).toHaveBeenCalledWith(id, staff.session);
    expect(s.submit).not.toHaveBeenCalled();
  }
);
it('reports the customer preference only for owned fields and never reflects raw input', async () => {
  const s = service(),
    c = new CustomerCancellationRequestController(s as never);
  const error = await c
    .submit(staff, id, { ...request(), preferredDestination: 'secret' })
    .catch((e) => e);
  expect(error.fields).toEqual(['preferredDestination']);
  expect(JSON.stringify(error.getResponse())).not.toContain('secret');
});
it.each([{ expectedVersionId: 'bad' }, { idempotencyKey: 'bad' }, { unknown: 'private' }, null])(
  'retains generic customer errors for protected, mixed or root failures %j',
  async (extra) => {
    const s = service(),
      c = new CustomerCancellationRequestController(s as never);
    const error = await c
      .submit(staff, id, extra ? { ...request(), reason: '', ...extra } : null)
      .catch((e) => e);
    expect(error.getResponse()).toEqual({ error: ErrorCodes.VALIDATION_PARSE_ZOD.code });
    expect(s.assertRequestAccess).not.toHaveBeenCalled();
    expect(s.submit).not.toHaveBeenCalled();
  }
);
it('does not expose customer field metadata before the ownership check succeeds', async () => {
  const s = service();
  s.assertRequestAccess.mockRejectedValue(new NotFoundException());
  const error = await new CustomerCancellationRequestController(s as never)
    .submit(staff, id, { ...request(), reason: '' })
    .catch((e) => e);
  expect(error.getStatus()).toBe(404);
  expect(error).not.toBeInstanceOf(InputFieldException);
});
it('keeps valid customer normalization and avoids additional reads', async () => {
  const s = service(),
    body = request();
  await new CustomerCancellationRequestController(s as never).submit(staff, id, body);
  expect(s.submit).toHaveBeenCalledWith(
    id,
    { ...body, reason: 'End service' },
    staff.session,
    staff.ip
  );
  expect(s.assertRequestAccess).not.toHaveBeenCalled();
});
it('authorizes staff rejection before returning reason fields', () => {
  const s = service(),
    c = new StaffCancellationRequestController(s as never),
    body = { reason: '', idempotencyKey: randomUUID() };
  expect(thrown(() => c.reject(denied, id, body)).getStatus()).toBe(403);
  expect(thrown(() => c.reject(staff, id, body))).toMatchObject({ fields: ['reason'] });
  expect(s.reject).not.toHaveBeenCalled();
});
it.each([{ idempotencyKey: 'bad' }, { extra: 'secret' }])(
  'keeps mixed staff rejection errors generic %j',
  (extra) => {
    const error = thrown(() =>
      new StaffCancellationRequestController(service() as never).reject(staff, id, {
        reason: '',
        idempotencyKey: randomUUID(),
        ...extra,
      })
    );
    expect(error.getResponse()).toEqual({ error: ErrorCodes.VALIDATION_PARSE_ZOD.code });
  }
);
it.each(['amount', 'destination'] as const)(
  'maps decision refund %s to a safe captured index',
  (field) => {
    const s = service(),
      body = decision();
    body.refundDecision.refunds[0]![field] = field === 'amount' ? '0' : 'wrong';
    const error = thrown(() =>
      new ContractCancellationController(s as never).prepare(staff, id, body)
    );
    expect(error).toMatchObject({
      fields: [`refund${field === 'amount' ? 'Amount' : 'Destination'}0`],
    });
    expect(s.prepare).not.toHaveBeenCalled();
  }
);
it('checks staff permission before decision metadata', () => {
  const error = thrown(() =>
    new ContractCancellationController(service() as never).prepare(denied, id, {
      ...decision(),
      reason: '',
    })
  );
  expect(error.getStatus()).toBe(403);
});
it.each([
  { expectedVersionId: 'bad' },
  { expectedFingerprint: 'bad' },
  { idempotencyKey: 'bad' },
  { customerRequestId: 'bad' },
  { extra: 'secret' },
  { refundDecision: { mode: 'wrong' } },
  {
    refundDecision: {
      mode: 'custom',
      refunds: [{ invoiceId: 'bad', amount: '0', destination: 'wallet' }],
    },
  },
])('keeps mixed/protected decision errors generic %j', (extra) => {
  const error = thrown(() =>
    new ContractCancellationController(service() as never).prepare(staff, id, {
      ...decision(),
      reason: '',
      ...extra,
    })
  );
  expect(error.getResponse()).toEqual({ error: ErrorCodes.VALIDATION_PARSE_ZOD.code });
});
it('keeps valid exact custom commands unchanged', () => {
  const s = service(),
    body = decision();
  new ContractCancellationController(s as never).prepare(staff, id, body);
  expect(s.prepare).toHaveBeenCalledWith(id, body, staff.session, staff.ip);
});
it('never turns execution protected fields into editor errors', () => {
  const error = thrown(() =>
    new ContractCancellationController(service() as never).execute(staff, id, {
      intentId: 'bad',
      idempotencyKey: randomUUID(),
    })
  );
  expect(error).not.toBeInstanceOf(InputFieldException);
});
it.each([[-1], [500], ['0'], [0, 'amount', 'extra']].map((path) => ({ path })))(
  'does not publish malformed index paths $path',
  ({ path }) => {
    expect(
      cancellationInputFields(
        [{ path: ['refundDecision', 'refunds', ...path, 'amount'] }],
        'decision'
      )
    ).toBeNull();
  }
);
