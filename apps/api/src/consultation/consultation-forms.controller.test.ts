import { HttpException } from '@nestjs/common';
import { expect, it, vi } from 'vitest';
import { InputFieldException } from '../common/input-field.exception.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { ConsultationRequestController } from './consultation-request.controller.js';
import {
  CustomerConsultationWorkflowController,
  StaffConsultationWorkflowController,
} from './consultation-workflow.controller.js';

const requestId = '11000000-0000-4000-8000-000000000001';
const input = {
  profileId: '12000000-0000-4000-8000-000000000001',
  productId: '13000000-0000-4000-8000-000000000001',
  submissionKey: '14000000-0000-4000-8000-000000000001',
};
const request = {
  session: { userId: 'reviewer', operatingContext: 'staff', permissions: ['orders:write'] },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest;
const actions = ['requestInfo', 'complete', 'reject', 'cancel'] as const;

function fixture() {
  const creation = { submit: vi.fn(() => ({ requestId, status: 'submitted' })) };
  const workflow = {
    provideInfo: vi.fn(() => ({ requestId, status: 'under_review' })),
    staffAction: vi.fn((_actor, id, action) => ({
      requestId: id,
      status: (
        {
          'request-info': 'awaiting_customer_info',
          complete: 'completed',
          reject: 'rejected',
          cancel: 'cancelled',
        } as Record<string, string>
      )[action],
    })),
    closePaid: vi.fn(),
    paidResolutionReview: vi.fn(),
    recoverRefund: vi.fn(),
  };
  const paidAuthority = vi.fn(async () => undefined);
  return {
    creation,
    workflow,
    paidAuthority,
    intake: new ConsultationRequestController(creation as never),
    customer: new CustomerConsultationWorkflowController(workflow as never),
    staff: new StaffConsultationWorkflowController({
      ...workflow,
      assertCanEditPaidResolution: paidAuthority,
    } as never),
  };
}
function failure(call: () => unknown) {
  try {
    call();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    return error as HttpException;
  }
  throw new Error('Expected validation rejection');
}
function owned(call: () => unknown, field: string) {
  const error = failure(call);
  expect(error).toBeInstanceOf(InputFieldException);
  expect((error as InputFieldException).fields).toEqual([field]);
  expect(JSON.stringify(error.getResponse())).not.toContain('PRIVATE');
}
function generic(call: () => unknown, status = 400) {
  const error = failure(call);
  expect(error.getStatus()).toBe(status);
  expect(error).not.toBeInstanceOf(InputFieldException);
  expect(JSON.stringify(error.getResponse())).not.toMatch(/PRIVATE|fields|submissionKey/);
}
function noCalls(value: ReturnType<typeof fixture>) {
  for (const method of [...Object.values(value.creation), ...Object.values(value.workflow)])
    expect(method).not.toHaveBeenCalled();
}

it.each([undefined, null, 42, 'PRIVATE'])(
  'projects only the editable product selection (%#)',
  (id) => {
    const value = fixture();
    owned(() => value.intake.submit({ ...input, productId: id }, request), 'productId');
    noCalls(value);
  }
);

it.each([undefined, null, [], 42, '', ' ', 'PRIVATE'.repeat(286)])(
  'projects required bounded information and staff reasons without invoking services (%#)',
  (reason) => {
    const value = fixture();
    owned(() => value.customer.provideInfo(requestId, { reason }, request), 'reason');
    for (const action of actions)
      owned(() => value.staff[action](requestId, { reason }, request), 'reason');
    noCalls(value);
  }
);

it('keeps protected, mixed, unknown and malformed structures general', () => {
  const value = fixture();
  for (const body of [
    null,
    [],
    { ...input, profileId: 'PRIVATE' },
    { ...input, submissionKey: 'PRIVATE' },
    { ...input, productId: 'PRIVATE', profileId: 'PRIVATE' },
    { ...input, productId: 'PRIVATE', unknown: 'PRIVATE' },
  ])
    generic(() => value.intake.submit(body, request));
  for (const body of [
    null,
    [],
    { reason: '', expectedReviewHash: 'PRIVATE' },
    { reason: 'PRIVATE', unknown: true },
  ]) {
    generic(() => value.customer.provideInfo(requestId, body, request));
    for (const action of actions) generic(() => value.staff[action](requestId, body, request));
  }
  noCalls(value);
});

it.each([
  { operatingContext: 'customer', permissions: ['orders:write'] },
  { operatingContext: 'staff', permissions: ['orders:read'] },
  { operatingContext: 'staff', permissions: [] },
])('requires current staff write capability before reason feedback (%#)', (session) => {
  const value = fixture();
  const denied = {
    ...request,
    session: { ...request.session, ...session },
  } as AuthenticatedRequest;
  for (const action of actions)
    generic(() => value.staff[action](requestId, { reason: '' }, denied), 403);
  noCalls(value);
});

it('passes normalized exact nonfinancial limits and retains the creation key and workflow receipts', () => {
  const value = fixture();
  expect(value.intake.submit(input, request)).toEqual({ requestId, status: 'submitted' });
  expect(value.creation.submit).toHaveBeenCalledWith(request.session, input, request.ip);
  const reason = 'r'.repeat(2000);
  expect(value.customer.provideInfo(requestId, { reason: ` ${reason} ` }, request)).toEqual({
    requestId,
    status: 'under_review',
  });
  expect(value.workflow.provideInfo).toHaveBeenCalledWith(
    request.session,
    requestId,
    reason,
    request.ip
  );
  for (const [method, action, status] of [
    ['requestInfo', 'request-info', 'awaiting_customer_info'],
    ['complete', 'complete', 'completed'],
    ['reject', 'reject', 'rejected'],
    ['cancel', 'cancel', 'cancelled'],
  ] as const) {
    expect(value.staff[method](requestId, { reason: ` ${reason} ` }, request)).toEqual({
      requestId,
      status,
    });
    expect(value.workflow.staffAction).toHaveBeenCalledWith(
      request.session,
      requestId,
      action,
      reason,
      request.ip
    );
  }
});

it('preserves the separate paid-reason limit and protected hash/idempotency parsing', async () => {
  const value = fixture();
  const rejection = async (result: Promise<unknown>, field?: string) => {
    let error: unknown;
    try {
      await result;
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(HttpException);
    if (!(error instanceof HttpException)) throw new Error('Expected validation rejection');
    expect(error.getStatus()).toBe(400);
    if (field) {
      expect(error).toBeInstanceOf(InputFieldException);
      if (!(error instanceof InputFieldException)) throw new Error('Expected owned rejection');
      expect(error.fields).toEqual([field]);
      expect(JSON.stringify(error.getResponse())).not.toMatch(/PRIVATE|submissionKey/);
    } else {
      expect(error).not.toBeInstanceOf(InputFieldException);
      expect(JSON.stringify(error.getResponse())).not.toMatch(/PRIVATE|fields|submissionKey/);
    }
  };
  const paid = {
    idempotencyKey: input.submissionKey,
    expectedReviewHash: 'a'.repeat(64),
    reason: 'r'.repeat(1000),
  };
  await value.staff.paidCancel(requestId, paid, request);
  expect(value.workflow.closePaid).toHaveBeenCalledWith(
    request.session,
    requestId,
    'cancel',
    paid,
    request.ip
  );
  expect(value.paidAuthority).not.toHaveBeenCalled();
  value.workflow.closePaid.mockClear();
  for (const method of ['paidCancel', 'paidReject', 'refundRecovery'] as const) {
    await rejection(
      value.staff[method](requestId, { ...paid, reason: 'PRIVATE'.repeat(143) }, request),
      'reason'
    );
    await rejection(
      value.staff[method](requestId, { ...paid, expectedReviewHash: 'PRIVATE' }, request)
    );
  }
  await rejection(
    value.staff.paidResolutionReview(
      requestId,
      { action: 'cancel', reason: 'PRIVATE'.repeat(143) },
      request
    ),
    'reason'
  );
  noCalls(value);
  expect(value.paidAuthority.mock.calls).toEqual([
    [request.session, requestId, false, true],
    [request.session, requestId, false, true],
    [request.session, requestId, true, true],
    [request.session, requestId, false, false],
  ]);
});
