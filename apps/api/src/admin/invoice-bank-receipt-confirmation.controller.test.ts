import { describe, it, expect, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { InvoiceBankReceiptConfirmationController } from './invoice-bank-receipt-confirmation.controller.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { ErrorCodes } from '@barghsa/shared/errors'
import { INVOICE_BANK_RECEIPT_CONFIRM_PERMISSION } from '@barghsa/shared/finance'

const RECEIPT_ID = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc'
const INVOICE_ID = '11111111-1111-7111-8111-111111111111'

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
  confirmedBy: null,
  confirmedAt: null,
  invoiceState: 'Unpaid',
  remaining: '1000000',
  invoiceAllocation: '250000',
  walletCreditAmount: '0',
  overpayment: null,
}

const adminReq = {
  session: { isAdmin: true, userId: 'admin-1' },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest

const nonAdminReq = {
  session: { isAdmin: false, userId: 'staff-1' },
  ip: '127.0.0.1',
} as unknown as AuthenticatedRequest

function makeController() {
  const listPending = vi.fn().mockResolvedValue([DTO])
  const get = vi.fn().mockResolvedValue(DTO)
  const confirm = vi.fn().mockResolvedValue({
    ...DTO,
    state: 'Confirmed',
    canConfirm: false,
    confirmedBy: 'admin-1',
    confirmedAt: '2026-09-03T08:00:00.000Z',
    auditId: 'audit-1',
  })
  const previewAllocation = vi.fn().mockResolvedValue({
    receiptId: RECEIPT_ID,
    invoiceId: INVOICE_ID,
    invoiceState: 'Unpaid',
    receiptAmount: '250000',
    remaining: '100000',
    invoiceAllocation: '100000',
    walletCreditAmount: '150000',
    isOverpayment: true,
  })
  const service = { listPending, get, confirm, previewAllocation }
  const correlationId = { getCorrelationId: vi.fn().mockReturnValue('corr-1') }
  const controller = new InvoiceBankReceiptConfirmationController(
    service as never,
    correlationId as never,
  )
  return { controller, service, correlationId }
}

function rejectionBody(error: unknown): Record<string, unknown> {
  if (error instanceof HttpException) {
    return error.getResponse() as Record<string, unknown>
  }
  throw new Error(`expected HttpException, got ${String(error)}`)
}

describe('invoice bank-receipt confirmation permission gate (T-04.3.01.03)', () => {
  it('rejects non-admin on list with AUTHZ_FORBIDDEN', async () => {
    const { controller, service } = makeController()
    const rejection = await controller.list(nonAdminReq).catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
    expect(rejectionBody(rejection)).toMatchObject({
      statusCode: 403,
      error: ErrorCodes.AUTHZ_FORBIDDEN.code,
    })
    expect(String(rejectionBody(rejection).message)).toContain(
      INVOICE_BANK_RECEIPT_CONFIRM_PERMISSION,
    )
    expect(service.listPending).not.toHaveBeenCalled()
  })

  it('rejects non-admin on confirm with AUTHZ_FORBIDDEN', async () => {
    const { controller, service } = makeController()
    const rejection = await controller.confirm(nonAdminReq, RECEIPT_ID).catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 403 })
    expect(service.confirm).not.toHaveBeenCalled()
  })

  it('rejects a non-UUID receipt id before calling the service', async () => {
    const { controller, service } = makeController()
    const rejection = await controller.get(adminReq, 'not-a-uuid').catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(rejectionBody(rejection)).toMatchObject({
      error: ErrorCodes.VALIDATION_PARSE_ZOD.code,
    })
    expect(service.get).not.toHaveBeenCalled()
  })

  it('allows admin list and wraps items', async () => {
    const { controller, service } = makeController()
    const result = await controller.list(adminReq)
    expect(result).toEqual({ items: [DTO] })
    expect(service.listPending).toHaveBeenCalledOnce()
  })

  it('forwards actor, ip, and correlation id on confirm', async () => {
    const { controller, service } = makeController()
    await controller.confirm(adminReq, RECEIPT_ID)
    expect(service.confirm).toHaveBeenCalledWith({
      receiptId: RECEIPT_ID,
      actorUserId: 'admin-1',
      ip: '127.0.0.1',
      correlationId: 'corr-1',
    })
  })

  it('forwards allocation preview without an extra invoiceId', async () => {
    const { controller, service } = makeController()
    const preview = await controller.allocation(adminReq, RECEIPT_ID)
    expect(preview.isOverpayment).toBe(true)
    expect(service.previewAllocation).toHaveBeenCalledWith(RECEIPT_ID)
  })
})
