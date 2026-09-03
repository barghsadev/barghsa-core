import { describe, it, expect, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import { CustomerInvoiceController } from './customer-invoice.controller.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { ErrorCodes } from '@barghsa/shared/errors'

const INVOICE_ID = '11111111-1111-7111-8111-111111111111'

const DETAILS = {
  viewedInvoiceId: INVOICE_ID,
  originalInvoiceId: INVOICE_ID,
  invoice: { invoiceId: INVOICE_ID, role: 'original' as const },
  chain: [{ invoiceId: INVOICE_ID, role: 'original' as const }],
}

const LIST = { invoices: [{ invoiceId: INVOICE_ID, role: 'original' as const }] }

const req = {
  session: { userId: 'user-1' },
} as unknown as AuthenticatedRequest

function makeController() {
  const getForUser = vi.fn().mockResolvedValue(DETAILS)
  const listForUser = vi.fn().mockResolvedValue(LIST)
  const service = { getForUser, listForUser }
  const submit = vi.fn().mockResolvedValue({
    receiptId: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
    invoiceId: INVOICE_ID,
    profileId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
    amount: 250_000n,
    state: 'Submitted',
    paymentDate: '2026-08-15',
    payerReference: 'TRK-1',
    attachmentKey: 'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf',
    customerNote: null,
  })
  const bankReceiptUpload = { submit }
  const controller = new CustomerInvoiceController(service as never, bankReceiptUpload as never)
  return { controller, service, bankReceiptUpload }
}

function rejectionBody(error: unknown): Record<string, unknown> {
  if (error instanceof HttpException) {
    return error.getResponse() as Record<string, unknown>
  }
  throw new Error(`expected HttpException, got ${String(error)}`)
}

describe('CustomerInvoiceController (T-04.1.05.04)', () => {
  it('rejects a non-UUID invoiceId before calling the service', async () => {
    const { controller, service } = makeController()
    const rejection = await controller.get(req, 'not-a-uuid').catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(rejectionBody(rejection)).toMatchObject({
      error: ErrorCodes.VALIDATION_PARSE_ZOD.code,
    })
    expect(service.getForUser).not.toHaveBeenCalled()
  })

  it('loads details for the authenticated user', async () => {
    const { controller, service } = makeController()
    const result = await controller.get(req, INVOICE_ID)
    expect(service.getForUser).toHaveBeenCalledWith('user-1', INVOICE_ID)
    expect(result.viewedInvoiceId).toBe(INVOICE_ID)
  })

  it('lists invoices for the authenticated user', async () => {
    const { controller, service } = makeController()
    const result = await controller.list(req)
    expect(service.listForUser).toHaveBeenCalledWith('user-1')
    expect(result.invoices).toHaveLength(1)
  })
})

describe('CustomerInvoiceController bank receipt upload (T-04.3.01.02)', () => {
  const body = {
    amount: '250000',
    paymentDate: '2026-08-15',
    payerReference: 'TRK-1',
    attachmentKey: 'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf',
  }

  it('rejects a non-UUID invoiceId before calling the upload service', async () => {
    const { controller, bankReceiptUpload } = makeController()
    const rejection = await controller
      .submitBankReceipt(req, 'not-a-uuid', body)
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(bankReceiptUpload.submit).not.toHaveBeenCalled()
  })

  it('rejects a body missing required fields', async () => {
    const { controller, bankReceiptUpload } = makeController()
    const rejection = await controller
      .submitBankReceipt(req, INVOICE_ID, { amount: 1 })
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 400 })
    expect(rejectionBody(rejection)).toMatchObject({
      error: ErrorCodes.VALIDATION_PARSE_ZOD.code,
    })
    expect(bankReceiptUpload.submit).not.toHaveBeenCalled()
  })

  it('returns a Submitted receipt with amount as a decimal string', async () => {
    const { controller, bankReceiptUpload } = makeController()
    const result = await controller.submitBankReceipt(req, INVOICE_ID, body)
    expect(bankReceiptUpload.submit).toHaveBeenCalledWith({
      userId: 'user-1',
      invoiceId: INVOICE_ID,
      amount: '250000',
      paymentDate: '2026-08-15',
      payerReference: 'TRK-1',
      attachmentKey: body.attachmentKey,
      customerNote: undefined,
    })
    expect(result).toMatchObject({
      ok: true,
      state: 'Submitted',
      amount: '250000',
      currency: 'IRR',
      invoiceId: INVOICE_ID,
    })
  })
})
