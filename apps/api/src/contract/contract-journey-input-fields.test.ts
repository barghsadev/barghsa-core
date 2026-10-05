import { HttpException } from '@nestjs/common';
import { expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { InputFieldException } from '../common/input-field.exception.js';
import { ContractReviewController } from './contract-review.controller.js';
import {
  ContractSignatureController,
  CustomerContractSignatureController,
} from './contract-signature.controller.js';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const versionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const requestId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const req = {
  session: { userId: 'opaque-staff', permissions: ['contracts:write'] },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest;
const routes = [
  'changes',
  'staff-preview',
  'customer-preview',
  'request',
  'staff-record',
  'customer-record',
] as const;
type Route = (typeof routes)[number];
function fixture(route: Route) {
  const authorize = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
  const saved = { original: 'durable engine result' };
  const work = vi.fn().mockResolvedValue(saved);
  const service = {
    assertCanRequestChanges: authorize,
    assertCanSelectDocument: authorize,
    act: work,
    financialReview: work,
    request: work,
    record: work,
  };
  const review = new ContractReviewController(service as never);
  const staff = new ContractSignatureController(service as never);
  const customer = new CustomerContractSignatureController(service as never);
  const request = route === 'request' || route === 'staff-preview';
  const preview = route.endsWith('preview');
  const customerRoute = route.startsWith('customer');
  const body =
    route === 'changes'
      ? {
          expectedVersionId: versionId.toUpperCase(),
          idempotencyKey: id.toUpperCase(),
          reason: '  Correct terms  ',
        }
      : {
          expectedVersionId: versionId.toUpperCase(),
          ...(request
            ? { originalDocumentId: id.toUpperCase(), expectedRequestId: null }
            : { signedDocumentId: id.toUpperCase(), requestId: requestId.toUpperCase() }),
          ...(preview
            ? { action: request ? 'request' : 'record' }
            : { idempotencyKey: id.toUpperCase(), expectedReviewHash: 'a'.repeat(64) }),
        };
  const invoke = (value: unknown, actor = req): Promise<unknown> =>
    route === 'changes'
      ? review.act(actor, id, 'request-changes', value)
      : preview
        ? (customerRoute ? customer : staff).financialReview(actor, id, value)
        : route === 'request'
          ? staff.request(actor, id, value)
          : (customerRoute ? customer : staff).record(actor, id, value);
  const field =
    route === 'changes' ? 'reason' : request ? 'originalDocumentId' : 'signedDocumentId';
  const normalized = Object.fromEntries(
    Object.entries(body).map(([key, value]) => [
      key,
      key === 'reason'
        ? 'Correct terms'
        : (typeof value === 'string' && key.endsWith('Id')) || key === 'idempotencyKey'
          ? String(value).toLowerCase()
          : value,
    ])
  );
  return {
    authorize,
    work,
    saved,
    body,
    normalized,
    invoke,
    field,
    preview,
    customerRoute,
    request,
    review,
  };
}
async function failure(work: Promise<unknown>) {
  try {
    await work;
  } catch (error) {
    if (error instanceof HttpException) return error;
    throw error;
  }
  throw new Error('Expected rejection');
}
it.each(routes)(
  '%s valid body bypasses field preflight and preserves exact normalized engine/result',
  async (route) => {
    const f = fixture(route);
    expect(await f.invoke(f.body)).toBe(f.saved);
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.work).toHaveBeenCalledWith(
      id,
      ...(route === 'changes' ? ['request-changes'] : []),
      f.normalized,
      req.session,
      ...(f.preview
        ? [!f.customerRoute]
        : [req.ip, ...(route === 'changes' || route === 'request' ? [] : [!f.customerRoute])])
    );
  }
);
it.each(routes)(
  '%s projects only its editable field after current authority without echo or effects',
  async (route) => {
    const f = fixture(route);
    for (const value of [undefined, null, '', 'PRIVATE'.repeat(200)]) {
      const error = await failure(f.invoke({ ...f.body, [f.field]: value }));
      expect(error).toBeInstanceOf(InputFieldException);
      expect(error).toMatchObject({ fields: [f.field] });
      expect(JSON.stringify(error.getResponse())).not.toMatch(/PRIVATE|Correct terms/);
    }
    expect(f.authorize).toHaveBeenCalledTimes(4);
    if (route === 'changes')
      expect(f.authorize).toHaveBeenLastCalledWith(id, versionId, req.session);
    else
      expect(f.authorize).toHaveBeenLastCalledWith(
        id,
        {
          action: f.request ? 'request' : 'record',
          versionId,
          requestId: f.request ? null : requestId,
        },
        req.session,
        !f.customerRoute,
        !f.preview
      );
    expect(f.work).not.toHaveBeenCalled();
  }
);
it.each(routes)(
  '%s protected, root, extra and mixed errors remain generic without preflight',
  async (route) => {
    const f = fixture(route);
    for (const body of [
      null,
      [],
      'PRIVATE',
      { ...f.body, expectedVersionId: 'PRIVATE' },
      { ...f.body, secret: 'PRIVATE' },
      { ...f.body, [f.field]: '', expectedVersionId: 'PRIVATE' },
      { ...f.body, [f.field]: '', secret: 'PRIVATE' },
      ...(f.preview
        ? [
            { ...f.body, action: 'PRIVATE' },
            { ...f.body, [f.field]: '', action: 'PRIVATE' },
          ]
        : [
            { ...f.body, [f.field]: '', idempotencyKey: 'PRIVATE' },
            ...(route === 'changes'
              ? []
              : [{ ...f.body, [f.field]: '', expectedReviewHash: 'PRIVATE' }]),
          ]),
      ...(route === 'changes' || f.request
        ? []
        : [{ ...f.body, [f.field]: '', requestId: 'PRIVATE' }]),
      ...(f.request ? [{ ...f.body, [f.field]: '', expectedRequestId: 'PRIVATE' }] : []),
    ]) {
      const error = await failure(f.invoke(body));
      expect(error.getStatus()).toBe(400);
      expect(error).not.toBeInstanceOf(InputFieldException);
      expect(error.getResponse()).toEqual({ error: 'VALIDATION:PARSE:ZOD_ERROR' });
    }
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.work).not.toHaveBeenCalled();
  }
);
it.each(routes)('%s current denial overrides owned field feedback', async (route) => {
  const f = fixture(route);
  for (const status of [401, 403, 404, 409]) {
    const denied = new HttpException('Current source authority', status);
    f.authorize.mockRejectedValueOnce(denied);
    expect(await failure(f.invoke({ ...f.body, [f.field]: '' }))).toBe(denied);
  }
  expect(f.work).not.toHaveBeenCalled();
});
it.each(['changes', 'staff-preview', 'request', 'staff-record'] as const)(
  '%s cached grant precedes validation',
  async (route) => {
    const f = fixture(route);
    const denied = {
      session: { ...req.session, permissions: [] },
      ip: req.ip,
    } as unknown as AuthenticatedRequest;
    for (const body of [f.body, { ...f.body, [f.field]: '' }, null])
      expect((await failure(f.invoke(body, denied))).getStatus()).toBe(403);
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.work).not.toHaveBeenCalled();
  }
);
it.each(['submit', 'publish'] as const)(
  '%s remains reason-free and skips invalid feedback authority',
  async (action) => {
    const f = fixture('changes');
    const { reason: _reason, ...body } = f.body;
    expect(await f.review.act(req, id, action, body)).toBe(f.saved);
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.work).toHaveBeenCalledWith(
      id,
      action,
      { expectedVersionId: versionId, idempotencyKey: id },
      req.session,
      req.ip
    );
  }
);
