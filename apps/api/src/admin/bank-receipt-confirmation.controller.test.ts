import { describe, it, expect, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { BankReceiptConfirmationController } from './bank-receipt-confirmation.controller.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { ErrorCodes } from '@barghsa/shared/errors';
import { BANK_RECEIPT_CONFIRM_PERMISSION } from '@barghsa/shared/finance';

const TX_ID = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc';
const REVIEW_HASH = 'a'.repeat(64);

const DTO = {
  transactionId: TX_ID,
  walletId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
  amount: '250000',
  currency: 'IRR' as const,
  state: 'Pending',
  paymentDate: '2026-08-15',
  payerReference: 'TRK-998877',
  attachmentKey: 'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf',
  attachmentUrl: null,
  customerNote: 'Branch transfer',
  submittedAt: '2026-09-01T10:00:00.000Z',
  canDecide: true,
  staffDecision: null,
  creditTransactionId: null,
  overpayment: null,
};

const adminReq = {
  session: {
    isAdmin: true,
    userId: 'admin-1',
    sessionId: 'staff-session',
    csrfToken: 'staff-csrf',
  },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest;

const nonAdminReq = {
  session: { isAdmin: false, userId: 'staff-1' },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest;

function makeController() {
  const listPendingPage = vi.fn().mockResolvedValue({ items: [DTO], nextCursor: null });
  const get = vi.fn().mockResolvedValue(DTO);
  const confirm = vi.fn().mockResolvedValue({
    ...DTO,
    state: 'Released',
    canDecide: false,
    creditTransactionId: 'credit-1',
    auditId: 'audit-1',
  });
  const reject = vi.fn().mockResolvedValue({
    ...DTO,
    state: 'Rejected',
    canDecide: false,
    auditId: 'audit-2',
  });
  const previewAllocation = vi.fn().mockResolvedValue({
    transactionId: TX_ID,
    invoiceId: '11111111-1111-7111-8111-111111111111',
    invoiceState: 'Unpaid',
    receiptAmount: '250000',
    remaining: '100000',
    invoiceAllocation: '100000',
    walletCreditAmount: '150000',
    isOverpayment: true,
  });
  const service = { listPendingPage, get, confirm, reject, previewAllocation };
  const correlationId = { getCorrelationId: vi.fn().mockReturnValue('corr-1') };
  const controller = new BankReceiptConfirmationController(
    service as never,
    correlationId as never
  );
  return { controller, service, correlationId };
}

function rejectionBody(error: unknown): Record<string, unknown> {
  if (error instanceof HttpException) {
    return error.getResponse() as Record<string, unknown>;
  }
  throw new Error(`expected HttpException, got ${String(error)}`);
}

describe('bank-receipt confirmation permission gate (T-04.2.02.04)', () => {
  it('rejects non-admin on list with AUTHZ_FORBIDDEN', async () => {
    const { controller, service } = makeController();
    const rejection = await controller.list(nonAdminReq).catch((e: unknown) => e);
    expect(rejection).toMatchObject({ status: 403 });
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 403,
      error: ErrorCodes.AUTHZ_FORBIDDEN.code,
    });
    expect(String(rejectionBody(rejection).message)).toContain(BANK_RECEIPT_CONFIRM_PERMISSION);
    expect(service.listPendingPage).not.toHaveBeenCalled();
  });

  it('rejects non-admin on confirm with AUTHZ_FORBIDDEN', async () => {
    const { controller, service } = makeController();
    const rejection = await controller.confirm(nonAdminReq, TX_ID).catch((e: unknown) => e);
    expect(rejection).toMatchObject({ status: 403 });
    expect(service.confirm).not.toHaveBeenCalled();
  });

  it('rejects non-admin on reject with AUTHZ_FORBIDDEN', async () => {
    const { controller, service } = makeController();
    const rejection = await controller
      .reject(nonAdminReq, TX_ID, { reason: 'Mismatch' })
      .catch((e: unknown) => e);
    expect(rejection).toMatchObject({ status: 403 });
    expect(service.reject).not.toHaveBeenCalled();
  });

  it('rejects a non-UUID transaction id before calling the service', async () => {
    const { controller, service } = makeController();
    const rejection = await controller.get(adminReq, 'not-a-uuid').catch((e: unknown) => e);
    expect(rejection).toMatchObject({ status: 400 });
    expect(rejectionBody(rejection)).toMatchObject({
      error: ErrorCodes.VALIDATION_PARSE_ZOD.code,
    });
    expect(service.get).not.toHaveBeenCalled();
  });

  it('allows admin list and wraps items', async () => {
    const { controller, service } = makeController();
    const result = await controller.list(adminReq);
    expect(result).toEqual({ items: [DTO], nextCursor: null });
    expect(service.listPendingPage).toHaveBeenCalledOnce();
  });

  it('forwards actor, ip, and correlation id on confirm', async () => {
    const { controller, service } = makeController();
    await controller.confirm(adminReq, TX_ID, { expectedReviewHash: REVIEW_HASH });
    expect(service.confirm).toHaveBeenCalledWith({
      transactionId: TX_ID,
      expectedReviewHash: REVIEW_HASH,
      actorUserId: 'admin-1',
      sessionId: 'staff-session',
      csrfToken: 'staff-csrf',
      ip: '127.0.0.1',
      invoiceId: null,
      correlationId: 'corr-1',
    });
  });

  it('forwards a confirm invoiceId for overpayment allocation', async () => {
    const { controller, service } = makeController();
    const invoiceId = '11111111-1111-7111-8111-111111111111';
    await controller.confirm(adminReq, TX_ID, { invoiceId, expectedReviewHash: REVIEW_HASH });
    expect(service.confirm).toHaveBeenCalledWith({
      transactionId: TX_ID,
      expectedReviewHash: REVIEW_HASH,
      actorUserId: 'admin-1',
      sessionId: 'staff-session',
      csrfToken: 'staff-csrf',
      ip: '127.0.0.1',
      invoiceId,
      correlationId: 'corr-1',
    });
  });

  it('forwards the reject body, actor, ip, and correlation id', async () => {
    const { controller, service } = makeController();
    await controller.reject(adminReq, TX_ID, { reason: 'Illegible scan' });
    expect(service.reject).toHaveBeenCalledWith({
      transactionId: TX_ID,
      raw: { reason: 'Illegible scan' },
      actorUserId: 'admin-1',
      sessionId: 'staff-session',
      csrfToken: 'staff-csrf',
      ip: '127.0.0.1',
      correlationId: 'corr-1',
    });
  });

  it.each([
    undefined,
    {},
    { expectedReviewHash: 'invalid' },
    { expectedReviewHash: REVIEW_HASH, extra: true },
  ])('rejects confirmation without an exact review contract: %j', async (body) => {
    const { controller, service } = makeController();
    await expect(controller.confirm(adminReq, TX_ID, body)).rejects.toMatchObject({ status: 400 });
    expect(service.confirm).not.toHaveBeenCalled();
  });

  it('previews allocation for a valid invoiceId', async () => {
    const { controller, service } = makeController();
    const invoiceId = '11111111-1111-7111-8111-111111111111';
    await controller.allocation(adminReq, TX_ID, invoiceId);
    expect(service.previewAllocation).toHaveBeenCalledWith(TX_ID, invoiceId);
  });

  it('rejects allocation preview without a UUID invoiceId', async () => {
    const { controller, service } = makeController();
    const rejection = await controller
      .allocation(adminReq, TX_ID, 'not-an-invoice')
      .catch((e: unknown) => e);
    expect(rejection).toMatchObject({ status: 400 });
    expect(service.previewAllocation).not.toHaveBeenCalled();
  });
});

it('validates literal queue search, order and paired exact cursor before listing', async () => {
  const { controller, service } = makeController();
  const id = '11111111-1111-4111-8111-111111111111';
  await controller.list(adminReq, {
    q: '  Bank_%  ',
    sort: 'submitted_at:desc',
    beforeAt: '2026-09-01T00:00:00.000001Z',
    beforeId: id,
  });
  expect(service.listPendingPage).toHaveBeenCalledWith({
    q: 'Bank_%',
    sort: 'submitted_at:desc',
    beforeAt: '2026-09-01T00:00:00.000001Z',
    beforeId: id,
  });
  for (const query of [
    { q: ['bank'] },
    { q: 'x'.repeat(121) },
    { q: 'bank\nname' },
    { sort: 'amount:asc' },
    { beforeId: id },
    { beforeAt: 'invalid', beforeId: id },
    { unknown: 'private' },
  ]) {
    await expect(controller.list(adminReq, query)).rejects.toMatchObject({ status: 400 });
  }
  expect(service.listPendingPage).toHaveBeenCalledTimes(1);
});
