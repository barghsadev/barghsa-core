/**
 * Customer invoice API (T-04.1.05.04 / T-04.3.01.02).
 *
 * Authenticated customers read invoices for their active profile:
 *   GET  /api/invoices                           → list (non-draft)
 *   GET  /api/invoices/:invoiceId                → details + correction chain
 *   POST /api/invoices/:invoiceId/bank-receipts  → submit a receipt (Submitted)
 *
 * Details include the original invoice and every linked replacement or
 * adjustment, each with the staff-supplied explanation of the change.
 * Receipt upload validates amount, file type/size, and inserts a
 * Submitted bank_receipts row without settling the invoice.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import { z } from 'zod'
import { ErrorCodes } from '@barghsa/shared/errors'
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js'
import { RateLimit } from '../rate-limit/rate-limit.decorator.js'
import {
  CustomerInvoiceDetailsService,
  type CustomerInvoiceDetailsDto,
  type CustomerInvoiceListDto,
} from './customer-invoice-details.service.js'
import { InvoiceBankReceiptUploadService } from './invoice-bank-receipt-upload.service.js'

const InvoiceBankReceiptBodySchema = z
  .object({
    amount: z.union([z.number(), z.string()]),
    paymentDate: z.string().min(1),
    payerReference: z.string().min(1),
    attachmentKey: z.string().min(1),
    customerNote: z.string().optional(),
  })
  .strict()

export interface InvoiceBankReceiptResponse {
  ok: true
  receiptId: string
  invoiceId: string
  amount: string
  currency: 'IRR'
  state: 'Submitted'
  paymentDate: string
  payerReference: string
  attachmentKey: string
}

function httpError(
  code: string,
  message: string,
  statusCode = 400,
): never {
  throw new HttpException({ statusCode, error: code, message }, statusCode)
}

function assertUuid(id: string, label = 'invoiceId'): void {
  const parsed = z.string().uuid('Expected a UUID').safeParse(id)
  if (!parsed.success) {
    httpError(
      ErrorCodes.VALIDATION_PARSE_ZOD.code,
      `Invalid ${label}: expected a UUID`,
      HttpStatus.BAD_REQUEST,
    )
  }
}

@ApiTags('Invoices')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/invoices')
export class CustomerInvoiceController {
  constructor(
    private readonly service: CustomerInvoiceDetailsService,
    private readonly bankReceiptUpload: InvoiceBankReceiptUploadService,
  ) {}

  @Get()
  @RateLimit({ namespace: 'invoices:list:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({
    summary: 'List invoices for the active profile',
    description:
      'Returns non-draft invoices on the caller\'s active profile, newest first.',
  })
  @ApiResponse({ status: 200, description: 'Invoice list for the active profile.' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'No active profile' })
  async list(@Req() req: AuthenticatedRequest): Promise<CustomerInvoiceListDto> {
    return this.service.listForUser(req.session.userId)
  }

  @Get(':invoiceId')
  @RateLimit({ namespace: 'invoices:get:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({
    summary: 'Get invoice details with the correction chain',
    description:
      'Returns the requested invoice plus the original and every linked ' +
      'replacement or adjustment, each with a customer-visible explanation.',
  })
  @ApiParam({ name: 'invoiceId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Invoice details and correction chain.' })
  @ApiResponse({ status: 400, description: 'invoiceId is not a UUID' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Invoice not found for the active profile' })
  async get(
    @Req() req: AuthenticatedRequest,
    @Param('invoiceId') invoiceId: string,
  ): Promise<CustomerInvoiceDetailsDto> {
    assertUuid(invoiceId)
    return this.service.getForUser(req.session.userId, invoiceId)
  }

  /**
   * POST /api/invoices/:invoiceId/bank-receipts
   *
   * Customer upload (T-04.3.01.02): validate amount, file type/size,
   * and create the receipt in Submitted. Invoice settlement waits for
   * staff confirmation.
   */
  @Post(':invoiceId/bank-receipts')
  @HttpCode(201)
  @RateLimit({ namespace: 'invoices:bank-receipt:user', limit: 10, windowMs: 60_000 })
  @ApiOperation({
    summary: 'Submit a bank receipt against an invoice (Submitted until staff confirm)',
  })
  @ApiParam({ name: 'invoiceId', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Submitted bank receipt created; invoice unchanged.' })
  @ApiResponse({ status: 400, description: 'Invalid amount, date, payer reference, or file' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Invoice not found for the active profile' })
  @ApiResponse({ status: 409, description: 'Invoice cannot receive a receipt, or attachment reused' })
  async submitBankReceipt(
    @Req() req: AuthenticatedRequest,
    @Param('invoiceId') invoiceId: string,
    @Body() rawBody: unknown,
  ): Promise<InvoiceBankReceiptResponse> {
    assertUuid(invoiceId)
    const parsed = InvoiceBankReceiptBodySchema.safeParse(rawBody ?? {})
    if (!parsed.success) {
      httpError(
        ErrorCodes.VALIDATION_PARSE_ZOD.code,
        'Bank receipt body must include amount, paymentDate, payerReference, and attachmentKey',
        HttpStatus.BAD_REQUEST,
      )
    }

    const result = await this.bankReceiptUpload.submit({
      userId: req.session.userId,
      invoiceId,
      amount: parsed.data.amount,
      paymentDate: parsed.data.paymentDate,
      payerReference: parsed.data.payerReference,
      attachmentKey: parsed.data.attachmentKey,
      customerNote: parsed.data.customerNote,
    })

    return {
      ok: true,
      receiptId: result.receiptId,
      invoiceId: result.invoiceId,
      amount: result.amount.toString(),
      currency: 'IRR',
      state: result.state,
      paymentDate: result.paymentDate,
      payerReference: result.payerReference,
      attachmentKey: result.attachmentKey,
    }
  }
}
