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
  const controller = new CustomerInvoiceController(service as never)
  return { controller, service }
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
