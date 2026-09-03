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
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'
import { z } from 'zod'
import { ErrorCodes } from '@barghsa/shared/errors'
import {
  BANK_RECEIPT_REJECT_REASON_MAX_LENGTH,
  INVOICE_BANK_RECEIPT_CONFIRM_PERMISSION,
} from '@barghsa/shared/finance'
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js'
import { StepUpGuard, RequiresStepUp } from '../session/step-up.guard.js'
import { CorrelationIdProvider } from '../common/correlation-id.middleware.js'
import {
  InvoiceBankReceiptConfirmationService,
  type InvoiceBankReceiptAllocationPreviewDto,
  type InvoiceBankReceiptConfirmDto,
} from '../invoice/invoice-bank-receipt-confirmation.service.js'

function httpError(
  code: string,
  message: string,
  statusCode = 400,
  details?: unknown,
): never {
  throw new HttpException(
    { statusCode, error: code, message, ...(details ? { details } : {}) },
    statusCode,
  )
}

function requestIp(req: AuthenticatedRequest): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown'
}

function assertUuid(id: string, label = 'receiptId'): void {
  const parsed = z.string().uuid('Expected a UUID').safeParse(id)
  if (!parsed.success) {
    httpError(ErrorCodes.VALIDATION_PARSE_ZOD.code, `Invalid ${label}: expected a UUID`, 400)
  }
}

/**
 * Staff invoice bank-receipt confirmation and rejection API
 * (T-04.3.01.03 / T-04.3.01.04 / S-04.3.01).
 *
 * Finance staff list Submitted / UnderReview receipts, inspect the scan,
 * preview the invoice vs wallet split, confirm, or reject with a
 * customer-visible reason. Confirm allocates `min(receipt, remaining)`
 * onto the invoice and credits only the excess to the profile wallet via
 * a distinct `WalletService.credit()` idempotency key. Staff cannot
 * over-settle `paid_amount`. Reject stores `rejection_reason`, never
 * changes invoice or wallet balances, and notifies the customer.
 *
 * Dual-approval for amounts at or above the admin-configured threshold
 * (T-04.3.01.05) parks the first confirmation until a second, different
 * finance staff member confirms.
 *
 * Security:
 * - Every route requires an authenticated session with the
 *   `admin:finance:invoices:bank-receipt-confirm` capability. Today the
 *   session model exposes only `req.session.isAdmin` (platform admin);
 *   granular staff-role permissions arrive with C-04.CC.03.
 * - Confirm and reject require recent step-up verification
 *   (`@RequiresStepUp()`) — payment confirmation is a financial action.
 */
@ApiTags('Admin · Invoice bank receipts')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, StepUpGuard)
@Controller('api/admin/invoices/bank-receipts')
export class InvoiceBankReceiptConfirmationController {
  constructor(
    private readonly service: InvoiceBankReceiptConfirmationService,
    private readonly correlationId: CorrelationIdProvider,
  ) {}

  private assertConfirmPermission(req: AuthenticatedRequest): void {
    if (!(req.session.isAdmin ?? false)) {
      httpError(
        ErrorCodes.AUTHZ_FORBIDDEN.code,
        `Admin role required (${INVOICE_BANK_RECEIPT_CONFIRM_PERMISSION})`,
        HttpStatus.FORBIDDEN,
      )
    }
  }

  @Get()
  @ApiOperation({ summary: 'List invoice bank receipts awaiting finance confirmation' })
  @ApiResponse({ status: 200, description: 'Submitted / UnderReview receipts.' })
  @ApiResponse({ status: 403, description: 'Finance permission required' })
  async list(
    @Req() req: AuthenticatedRequest,
  ): Promise<{ items: InvoiceBankReceiptConfirmDto[] }> {
    this.assertConfirmPermission(req)
    const items = await this.service.listPending()
    return { items }
  }

  @Get(':receiptId/allocation')
  @ApiOperation({
    summary: 'Preview invoice vs wallet split for an invoice bank receipt (staff)',
    description:
      'If the receipt exceeds invoice remaining, the excess is a wallet credit and the invoice is not over-settled.',
  })
  @ApiParam({ name: 'receiptId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Allocation preview (invoice remaining vs excess).' })
  @ApiResponse({ status: 403, description: 'Finance permission required' })
  @ApiResponse({ status: 404, description: 'Receipt or invoice not found' })
  @ApiResponse({ status: 409, description: 'Invoice cannot receive a bank-receipt allocation' })
  async allocation(
    @Req() req: AuthenticatedRequest,
    @Param('receiptId') receiptId: string,
  ): Promise<InvoiceBankReceiptAllocationPreviewDto> {
    this.assertConfirmPermission(req)
    assertUuid(receiptId)
    return this.service.previewAllocation(receiptId)
  }

  @Get(':receiptId')
  @ApiOperation({ summary: 'Get an invoice bank receipt for staff review' })
  @ApiParam({ name: 'receiptId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Receipt details including a short-lived preview URL.' })
  @ApiResponse({ status: 403, description: 'Finance permission required' })
  @ApiResponse({ status: 404, description: 'Receipt not found' })
  async get(
    @Req() req: AuthenticatedRequest,
    @Param('receiptId') receiptId: string,
  ): Promise<InvoiceBankReceiptConfirmDto> {
    this.assertConfirmPermission(req)
    assertUuid(receiptId)
    return this.service.get(receiptId)
  }

  @Post(':receiptId/confirm')
  @HttpCode(200)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Confirm an invoice bank receipt',
    description:
      'If the receipt amount is below the dual-approval threshold (or dual approval is disabled), settles min(receipt, remaining) on the linked invoice and credits only the excess to the profile wallet. Amounts at or above the admin-configured threshold park the receipt until a second, different finance staff member confirms.',
  })
  @ApiParam({ name: 'receiptId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description:
      'Receipt confirmed, or parked in UnderReview awaiting a second finance staff confirmation.',
  })
  @ApiResponse({ status: 403, description: 'Permission or step-up required' })
  @ApiResponse({ status: 404, description: 'Receipt not found' })
  @ApiResponse({ status: 409, description: 'Receipt is not awaiting confirmation' })
  async confirm(
    @Req() req: AuthenticatedRequest,
    @Param('receiptId') receiptId: string,
  ): Promise<InvoiceBankReceiptConfirmDto> {
    this.assertConfirmPermission(req)
    assertUuid(receiptId)
    const correlationId = this.correlationId.getCorrelationId()
    return this.service.confirm({
      receiptId,
      actorUserId: req.session.userId,
      ip: requestIp(req),
      ...(correlationId ? { correlationId } : {}),
    })
  }

  @Post(':receiptId/reject')
  @HttpCode(200)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Reject an invoice bank receipt with a customer-visible reason',
    description:
      'Marks the receipt Rejected, stores the reason, and notifies the customer. Never changes invoice paid amount or wallet balance.',
  })
  @ApiParam({ name: 'receiptId', format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['reason'],
      properties: {
        reason: {
          type: 'string',
          minLength: 1,
          maxLength: BANK_RECEIPT_REJECT_REASON_MAX_LENGTH,
          description: 'Customer-visible rejection reason',
          example: 'Payer name does not match the profile',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Receipt rejected; customer notified; balances unchanged.' })
  @ApiResponse({ status: 400, description: 'Reason missing or invalid' })
  @ApiResponse({ status: 403, description: 'Permission or step-up required' })
  @ApiResponse({ status: 404, description: 'Receipt not found' })
  @ApiResponse({ status: 409, description: 'Receipt is not awaiting review' })
  async reject(
    @Req() req: AuthenticatedRequest,
    @Param('receiptId') receiptId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<InvoiceBankReceiptConfirmDto> {
    this.assertConfirmPermission(req)
    assertUuid(receiptId)
    const correlationId = this.correlationId.getCorrelationId()
    return this.service.reject({
      receiptId,
      raw: body,
      actorUserId: req.session.userId,
      ip: requestIp(req),
      ...(correlationId ? { correlationId } : {}),
    })
  }
}
