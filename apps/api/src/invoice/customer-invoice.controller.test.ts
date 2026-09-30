import { describe, it, expect, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { CustomerInvoiceController } from './customer-invoice.controller.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { ErrorCodes } from '@barghsa/shared/errors';
import { CUSTOMER_INVOICE_STATUSES } from '@barghsa/shared/validation';
import { INVOICE_STATES } from './invoice-state.model.js';

it('offers every customer-visible invoice state and never Draft', () => {
  expect(CUSTOMER_INVOICE_STATUSES).toEqual(INVOICE_STATES.filter((state) => state !== 'Draft'));
});

const INVOICE_ID = '11111111-1111-7111-8111-111111111111';

const DETAILS = {
  viewedInvoiceId: INVOICE_ID,
  originalInvoiceId: INVOICE_ID,
  invoice: { invoiceId: INVOICE_ID, role: 'original' as const },
  chain: [{ invoiceId: INVOICE_ID, role: 'original' as const }],
};

const LIST = { invoices: [{ invoiceId: INVOICE_ID, role: 'original' as const }] };

const req = {
  session: { userId: 'user-1' },
} as unknown as AuthenticatedRequest;

function makeController() {
  const getForUser = vi.fn().mockResolvedValue(DETAILS);
  const listForUser = vi.fn().mockResolvedValue(LIST);
  const listBankReceiptsForUser = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
  const receiptPreviewForUser = vi.fn().mockResolvedValue(Buffer.from('png'));
  const service = { getForUser, listForUser, listBankReceiptsForUser, receiptPreviewForUser };
  const submit = vi.fn().mockResolvedValue({
    receiptId: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
    invoiceId: INVOICE_ID,
    profileId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
    amount: 250_000n,
    state: 'Submitted',
    paymentDate: '2026-08-15',
    payerReference: 'TRK-1',
    bankName: 'Bank Mellat',
    attachmentKey: 'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf',
    customerNote: null,
  });
  const review = vi.fn().mockResolvedValue({ hash: 'a'.repeat(64) });
  const bankReceiptUpload = { submit, review };
  const controller = new CustomerInvoiceController(service as never, bankReceiptUpload as never);
  return { controller, service, bankReceiptUpload };
}

function rejectionBody(error: unknown): Record<string, unknown> {
  if (error instanceof HttpException) {
    return error.getResponse() as Record<string, unknown>;
  }
  throw new Error(`expected HttpException, got ${String(error)}`);
}

describe('CustomerInvoiceController (T-04.1.05.04)', () => {
  it('rejects a non-UUID invoiceId before calling the service', async () => {
    const { controller, service } = makeController();
    const rejection = await controller.get(req, 'not-a-uuid').catch((e: unknown) => e);
    expect(rejection).toMatchObject({ status: 400 });
    expect(rejectionBody(rejection)).toMatchObject({
      error: ErrorCodes.VALIDATION_PARSE_ZOD.code,
    });
    expect(service.getForUser).not.toHaveBeenCalled();
  });

  it('loads details for the authenticated user', async () => {
    const { controller, service } = makeController();
    const result = await controller.get(req, INVOICE_ID);
    expect(service.getForUser).toHaveBeenCalledWith('user-1', INVOICE_ID, req.session);
    expect(result.viewedInvoiceId).toBe(INVOICE_ID);
  });

  it('lists invoices for the authenticated user', async () => {
    const { controller, service } = makeController();
    const result = await controller.list(req);
    expect(service.listForUser).toHaveBeenCalledWith(
      'user-1',
      req.session,
      false,
      expect.objectContaining({ statuses: [], q: '', sort: 'created_at:desc' })
    );
    expect(result.invoices).toHaveLength(1);
  });

  it('validates and forwards the unpaid-only invoice filter', async () => {
    const { controller, service } = makeController();
    await controller.list(req, 'unpaid');
    expect(service.listForUser).toHaveBeenCalledWith(
      'user-1',
      req.session,
      true,
      expect.objectContaining({ statuses: [], q: '', sort: 'created_at:desc' })
    );
    await expect(controller.list(req, 'paid')).rejects.toMatchObject({ status: 400 });
    expect(service.listForUser).toHaveBeenCalledTimes(1);
  });
});

describe('CustomerInvoiceController bank receipt upload (T-04.3.01.02)', () => {
  const body = {
    amount: '250000',
    paymentDate: '2026-08-15',
    payerReference: 'TRK-1',
    bankName: 'Bank Mellat',
    attachmentKey: 'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf',
    expectedReviewHash: 'a'.repeat(64),
  };

  it('rejects a non-UUID invoiceId before calling the upload service', async () => {
    const { controller, bankReceiptUpload } = makeController();
    const rejection = await controller
      .submitBankReceipt(req, 'not-a-uuid', body)
      .catch((e: unknown) => e);
    expect(rejection).toMatchObject({ status: 400 });
    expect(bankReceiptUpload.submit).not.toHaveBeenCalled();
  });

  it('rejects a body missing required fields', async () => {
    const { controller, bankReceiptUpload } = makeController();
    const rejection = await controller
      .submitBankReceipt(req, INVOICE_ID, { amount: 1 })
      .catch((e: unknown) => e);
    expect(rejection).toMatchObject({ status: 400 });
    expect(rejectionBody(rejection)).toMatchObject({
      error: ErrorCodes.VALIDATION_PARSE_ZOD.code,
    });
    expect(bankReceiptUpload.submit).not.toHaveBeenCalled();
  });

  it('rejects an oversized bank name before uploading', async () => {
    const { controller, bankReceiptUpload } = makeController();
    await expect(
      controller.submitBankReceipt(req, INVOICE_ID, { ...body, bankName: 'x'.repeat(129) })
    ).rejects.toMatchObject({ status: 400 });
    expect(bankReceiptUpload.submit).not.toHaveBeenCalled();
  });

  it('requires the exact review hash for submission', async () => {
    const { controller, bankReceiptUpload } = makeController();
    const { expectedReviewHash: _hash, ...unreviewed } = body;
    await expect(controller.submitBankReceipt(req, INVOICE_ID, unreviewed)).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      controller.submitBankReceipt(req, INVOICE_ID, { ...body, expectedReviewHash: 'invalid' })
    ).rejects.toMatchObject({ status: 400 });
    expect(bankReceiptUpload.submit).not.toHaveBeenCalled();
  });

  it('returns a Submitted receipt with amount as a decimal string', async () => {
    const { controller, bankReceiptUpload } = makeController();
    const result = await controller.submitBankReceipt(req, INVOICE_ID, body);
    expect(bankReceiptUpload.submit).toHaveBeenCalledWith({
      userId: 'user-1',
      invoiceId: INVOICE_ID,
      amount: '250000',
      paymentDate: '2026-08-15',
      payerReference: 'TRK-1',
      bankName: 'Bank Mellat',
      attachmentKey: body.attachmentKey,
      customerNote: undefined,
      expectedReviewHash: body.expectedReviewHash,
    });
    expect(result).toMatchObject({
      ok: true,
      state: 'Submitted',
      amount: '250000',
      currency: 'IRR',
      invoiceId: INVOICE_ID,
      bankName: 'Bank Mellat',
    });
  });

  it('previews the receipt without accepting a confirmation hash', async () => {
    const { controller, bankReceiptUpload } = makeController();
    const { expectedReviewHash: _hash, ...reviewFields } = body;
    await controller.reviewBankReceipt(req, INVOICE_ID, reviewFields);
    expect(bankReceiptUpload.review).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: INVOICE_ID, ...reviewFields })
    );
    await expect(controller.reviewBankReceipt(req, INVOICE_ID, body)).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('bank receipt filters', () => {
  it('normalizes statuses and preserves exact cursor and authenticated actor', async () => {
    const { controller, service } = makeController();
    const beforeAt = '2026-09-01T00:00:00.000002Z';
    await controller.listBankReceipts(req, {
      statuses: 'Rejected,Submitted,Rejected',
      beforeAt,
      beforeId: INVOICE_ID,
    });
    expect(service.listBankReceiptsForUser).toHaveBeenCalledWith('user-1', req.session, {
      statuses: ['Submitted', 'Rejected'],
      beforeAt,
      beforeId: INVOICE_ID,
    });
    await controller.listBankReceipts(req, { state: 'Rejected' });
    expect(service.listBankReceiptsForUser).toHaveBeenLastCalledWith('user-1', req.session, {
      statuses: ['Rejected'],
    });
  });
  it.each([
    { statuses: 'Pending' },
    { statuses: 'Submitted,' },
    { statuses: 'Submitted,Submitted,Submitted,Submitted,Submitted' },
    { statuses: ['Submitted'] },
    { state: 'Rejected', statuses: '' },
    { beforeId: INVOICE_ID },
  ])('rejects malformed or ambiguous filters %j', (query) => {
    const { controller, service } = makeController();
    expect(() => controller.listBankReceipts(req, query)).toThrow(HttpException);
    expect(service.listBankReceiptsForUser).not.toHaveBeenCalled();
  });
});

it('validates receipt preview IDs and forwards the current session without exposing a URL', async () => {
  const { controller, service } = makeController();
  await expect(controller.receiptPreview(req, 'invalid', INVOICE_ID)).rejects.toThrow(
    HttpException
  );
  await expect(controller.receiptPreview(req, INVOICE_ID, 'invalid')).rejects.toThrow(
    HttpException
  );
  expect(service.receiptPreviewForUser).not.toHaveBeenCalled();
  const image = await controller.receiptPreview(req, INVOICE_ID, INVOICE_ID);
  expect(service.receiptPreviewForUser).toHaveBeenCalledWith(
    'user-1',
    INVOICE_ID,
    INVOICE_ID,
    req.session
  );
  expect(image.getHeaders()).toMatchObject({ type: 'image/png', disposition: 'inline', length: 3 });
});
