import { describe, it, expect, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { InvoiceBankReceiptConfirmationController } from './invoice-bank-receipt-confirmation.controller.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { ErrorCodes } from '@barghsa/shared/errors';
import { INVOICE_BANK_RECEIPT_CONFIRM_PERMISSION } from '@barghsa/shared/finance';

const RECEIPT_ID = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc';
const INVOICE_ID = '11111111-1111-7111-8111-111111111111';
const REVIEW_HASH = 'a'.repeat(64);

const DTO = {
  receiptId: RECEIPT_ID,
  invoiceId: INVOICE_ID,
  profileId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
  amount: '250000',
  currency: 'IRR' as const,
  state: 'Submitted',
  paymentDate: '2026-08-15',
  payerReference: 'TRK-998877',
  attachmentKey: 'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf',
  attachmentUrl: null,
  customerNote: 'Branch transfer',
  submittedAt: '2026-09-01T10:00:00.000Z',
  canConfirm: true,
  canReject: true,
  confirmedBy: null,
  confirmedAt: null,
  rejectionReason: null,
  invoiceState: 'Unpaid',
  remaining: '1000000',
  invoiceAllocation: '250000',
  walletCreditAmount: '0',
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
  const listHistory = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
  const get = vi.fn().mockResolvedValue(DTO);
  const review = vi.fn().mockResolvedValue({ hash: REVIEW_HASH });
  const confirm = vi.fn().mockResolvedValue({
    ...DTO,
    state: 'Confirmed',
    canConfirm: false,
    confirmedBy: 'admin-1',
    confirmedAt: '2026-09-03T08:00:00.000Z',
    auditId: 'audit-1',
  });
  const reject = vi.fn().mockResolvedValue({
    ...DTO,
    state: 'Rejected',
    canConfirm: false,
    canReject: false,
    rejectionReason: 'Illegible scan',
    auditId: 'audit-2',
  });
  const previewAllocation = vi.fn().mockResolvedValue({
    receiptId: RECEIPT_ID,
    invoiceId: INVOICE_ID,
    invoiceState: 'Unpaid',
    receiptAmount: '250000',
    remaining: '100000',
    invoiceAllocation: '100000',
    walletCreditAmount: '150000',
    isOverpayment: true,
  });
  const service = { listPendingPage, listHistory, get, review, confirm, reject, previewAllocation };
  const correlationId = { getCorrelationId: vi.fn().mockReturnValue('corr-1') };
  const controller = new InvoiceBankReceiptConfirmationController(
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

describe('invoice bank-receipt confirmation and rejection permission gate (T-04.3.01.03 / T-04.3.01.04)', () => {
  it('rejects non-admin on list with AUTHZ_FORBIDDEN', async () => {
    const { controller, service } = makeController();
    const rejection = await controller.list(nonAdminReq).catch((e: unknown) => e);
    expect(rejection).toMatchObject({ status: 403 });
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 403,
      error: ErrorCodes.AUTHZ_FORBIDDEN.code,
    });
    expect(String(rejectionBody(rejection).message)).toContain(
      INVOICE_BANK_RECEIPT_CONFIRM_PERMISSION
    );
    expect(service.listPendingPage).not.toHaveBeenCalled();
  });

  it('rejects non-admin on confirm with AUTHZ_FORBIDDEN', async () => {
    const { controller, service } = makeController();
    const rejection = await controller.confirm(nonAdminReq, RECEIPT_ID).catch((e: unknown) => e);
    expect(rejection).toMatchObject({ status: 403 });
    expect(service.confirm).not.toHaveBeenCalled();
  });

  it('rejects non-admin on reject with AUTHZ_FORBIDDEN', async () => {
    const { controller, service } = makeController();
    const rejection = await controller
      .reject(nonAdminReq, RECEIPT_ID, { reason: 'Mismatch' })
      .catch((e: unknown) => e);
    expect(rejection).toMatchObject({ status: 403 });
    expect(service.reject).not.toHaveBeenCalled();
  });

  it('rejects a non-UUID receipt id before calling the service', async () => {
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

  it('accepts a validated history filter and paired cursor', async () => {
    const { controller, service } = makeController();
    await controller.history(adminReq, {
      state: 'Confirmed',
      invoiceId: INVOICE_ID,
      beforeAt: '2026-09-01T10:00:00.000200Z',
      beforeId: RECEIPT_ID,
    });
    expect(service.listHistory).toHaveBeenCalledWith({
      q: '',
      sort: 'submitted_at:desc',
      from: undefined,
      to: undefined,
      min: undefined,
      max: undefined,
      state: 'Confirmed',
      invoiceId: INVOICE_ID,
      beforeAt: '2026-09-01T10:00:00.000200Z',
      beforeId: RECEIPT_ID,
    });
  });

  it('blocks malformed history cursors and unauthorized history reads', async () => {
    const { controller, service } = makeController();
    await expect(
      controller.history(adminReq, { beforeAt: '2026-09-01T10:00:00Z' })
    ).rejects.toMatchObject({
      status: 400,
    });
    await expect(controller.history(nonAdminReq, {})).rejects.toMatchObject({ status: 403 });
    expect(service.listHistory).not.toHaveBeenCalled();
  });

  it('forwards actor, ip, and correlation id on confirm', async () => {
    const { controller, service } = makeController();
    await controller.confirm(adminReq, RECEIPT_ID, { expectedReviewHash: REVIEW_HASH });
    expect(service.confirm).toHaveBeenCalledWith({
      receiptId: RECEIPT_ID,
      expectedReviewHash: REVIEW_HASH,
      actorUserId: 'admin-1',
      sessionId: 'staff-session',
      csrfToken: 'staff-csrf',
      ip: '127.0.0.1',
      correlationId: 'corr-1',
    });
  });

  it('requires a review hash and exposes the authorized financial review', async () => {
    const { controller, service } = makeController();
    await expect(controller.confirm(adminReq, RECEIPT_ID, {})).rejects.toMatchObject({
      status: 400,
    });
    expect(service.confirm).not.toHaveBeenCalled();
    expect(await controller.review(adminReq, RECEIPT_ID, {})).toEqual({ hash: REVIEW_HASH });
    expect(service.review).toHaveBeenCalledWith({
      receiptId: RECEIPT_ID,
      actorUserId: 'admin-1',
      sessionId: 'staff-session',
      csrfToken: 'staff-csrf',
    });
    await expect(controller.review(nonAdminReq, RECEIPT_ID, {})).rejects.toMatchObject({
      status: 403,
    });
  });

  it('forwards the reject body, actor, ip, and correlation id', async () => {
    const { controller, service } = makeController();
    await controller.reject(adminReq, RECEIPT_ID, { reason: 'Illegible scan' });
    expect(service.reject).toHaveBeenCalledWith({
      receiptId: RECEIPT_ID,
      raw: { reason: 'Illegible scan' },
      actorUserId: 'admin-1',
      sessionId: 'staff-session',
      csrfToken: 'staff-csrf',
      ip: '127.0.0.1',
      correlationId: 'corr-1',
    });
  });

  it('forwards allocation preview without an extra invoiceId', async () => {
    const { controller, service } = makeController();
    const preview = await controller.allocation(adminReq, RECEIPT_ID);
    expect(preview.isOverpayment).toBe(true);
    expect(service.previewAllocation).toHaveBeenCalledWith(RECEIPT_ID);
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

it('normalizes reviewed receipt search and exact ranges, rejecting ambiguous and invalid criteria before reads', async () => {
  const { controller, service } = makeController();
  await controller.history(adminReq, {
    q: '  بانک_%\\  ',
    sort: 'submitted_at:asc',
    min: '۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۳',
    max: '9223372036854775807',
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-10-01T00:00:00.000Z',
  });
  expect(service.listHistory).toHaveBeenCalledWith(
    expect.objectContaining({
      q: 'بانک_%\\',
      sort: 'submitted_at:asc',
      min: '9007199254740993',
      max: '9223372036854775807',
    })
  );
  for (const query of [
    { q: 'x'.repeat(121) },
    { q: 'bank\nname' },
    { q: ['one', 'two'] },
    { sort: 'amount:asc' },
    { min: '9223372036854775808' },
    { min: Number('9007199254740993') },
    { min: '2', max: '1' },
    { max: '-1' },
    { unknown: 'private' },
    { from: '2026-02-30T00:00:00.000Z' },
    { from: '2026-10-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
  ])
    await expect(controller.history(adminReq, query)).rejects.toMatchObject({ status: 400 });
  expect(service.listHistory).toHaveBeenCalledTimes(1);
});
