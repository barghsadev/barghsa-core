import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'
import { z } from 'zod'
import { ErrorCodes } from '@barghsa/shared/errors'
import {
  BANK_RECEIPT_CONFIRM_PERMISSION,
  BANK_RECEIPT_OVERPAYMENT_ERRORS,
  BANK_RECEIPT_REJECT_REASON_MAX_LENGTH,
  parseOptionalInvoiceId,
} from '@barghsa/shared/finance'
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js'
import { StepUpGuard, RequiresStepUp } from '../session/step-up.guard.js'
import { CorrelationIdProvider } from '../common/correlation-id.middleware.js'
import {
  BankReceiptConfirmationService,
  type BankReceiptAllocationPreviewDto,
  type BankReceiptReviewDto,
} from '../wallet/bank-receipt-confirmation.service.js'

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

function assertUuid(id: string, label = 'transactionId'): void {
  const parsed = z.string().uuid('Expected a UUID').safeParse(id)
  if (!parsed.success) {
    httpError(ErrorCodes.VALIDATION_PARSE_ZOD.code, `Invalid ${label}: expected a UUID`, 400)
  }
}

/**
 * Staff bank-receipt top-up review API (T-04.2.02.04 / S-04.2.02).
 *
 * Finance staff list Pending receipts, inspect the scan, and confirm or
 * reject with a customer-visible reason. Confirm without an invoice
 * credits the full receipt via `WalletService.credit()`. Confirm with
 * an invoice allocates up to remaining onto the invoice and credits
 * only the excess to the wallet (T-04.2.02.05). Reject never changes
 * posted or reserved balance.
 *
 * Security:
 * - Every route requires an authenticated session with the
 *   `admin:finance:wallet:bank-receipt-confirm` capability. Today the
 *   session model exposes only `req.session.isAdmin` (platform admin);
 *   granular staff-role permissions arrive with C-04.CC.03.
 * - Confirm and reject require recent step-up verification
 *   (`@RequiresStepUp()`) — payment confirmation is a financial action.
 */
@ApiTags('Admin · Wallet bank receipts')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, StepUpGuard)
@Controller('api/admin/wallet/bank-receipt-top-ups')
export class BankReceiptConfirmationController {
  constructor(
    private readonly service: BankReceiptConfirmationService,
    private readonly correlationId: CorrelationIdProvider,
  ) {}

  private assertConfirmPermission(req: AuthenticatedRequest): void {
    if (!(req.session.isAdmin ?? false)) {
      httpError(
        ErrorCodes.AUTHZ_FORBIDDEN.code,
        `Admin role required (${BANK_RECEIPT_CONFIRM_PERMISSION})`,
        HttpStatus.FORBIDDEN,
      )
    }
  }

  @Get()
  @ApiOperation({ summary: 'List pending bank-receipt wallet top-ups (staff)' })
  @ApiResponse({ status: 200, description: 'Pending receipts awaiting finance review.' })
  @ApiResponse({ status: 403, description: 'Finance permission required' })
  async list(@Req() req: AuthenticatedRequest): Promise<{ items: BankReceiptReviewDto[] }> {
    this.assertConfirmPermission(req)
    const items = await this.service.listPending()
    return { items }
  }

  @Get(':transactionId/allocation')
  @ApiOperation({
    summary: 'Preview invoice vs wallet split for a bank receipt (staff)',
    description:
      'If the receipt exceeds invoice remaining, the excess is a wallet credit and the invoice is not over-settled.',
  })
  @ApiParam({ name: 'transactionId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Allocation preview (invoice remaining vs excess).' })
  @ApiResponse({ status: 400, description: 'invoiceId missing or not a UUID' })
  @ApiResponse({ status: 403, description: 'Finance permission required' })
  @ApiResponse({ status: 404, description: 'Receipt or invoice not found' })
  async allocation(
    @Req() req: AuthenticatedRequest,
    @Param('transactionId') transactionId: string,
    @Query('invoiceId') invoiceId: string,
  ): Promise<BankReceiptAllocationPreviewDto> {
    this.assertConfirmPermission(req)
    assertUuid(transactionId)
    const parsed = parseOptionalInvoiceId({ invoiceId })
    if (!parsed.ok || !parsed.invoiceId) {
      httpError(
        ErrorCodes.VALIDATION_INPUT_INVALID.code,
        BANK_RECEIPT_OVERPAYMENT_ERRORS.BAD_INVOICE_ID(),
        400,
      )
    }
    return this.service.previewAllocation(transactionId, parsed.invoiceId)
  }

  @Get(':transactionId')
  @ApiOperation({ summary: 'Get a bank-receipt top-up for staff review' })
  @ApiParam({ name: 'transactionId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Receipt details including a short-lived preview URL.' })
  @ApiResponse({ status: 403, description: 'Finance permission required' })
  @ApiResponse({ status: 404, description: 'Receipt not found' })
  async get(
    @Req() req: AuthenticatedRequest,
    @Param('transactionId') transactionId: string,
  ): Promise<BankReceiptReviewDto> {
    this.assertConfirmPermission(req)
    assertUuid(transactionId)
    return this.service.get(transactionId)
  }

  @Post(':transactionId/confirm')
  @HttpCode(200)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Confirm a bank-receipt top-up',
    description:
      'Without invoiceId, credits the full amount via WalletService.credit(). With invoiceId, settles min(receipt, remaining) on the invoice and credits only the excess to the wallet with a distinct idempotency key.',
  })
  @ApiParam({ name: 'transactionId', format: 'uuid' })
  @ApiBody({
    required: false,
    schema: {
      type: 'object',
      properties: {
        invoiceId: {
          type: 'string',
          format: 'uuid',
          description:
            'Optional invoice to apply the receipt against. Excess over remaining is credited to the wallet.',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Receipt confirmed; wallet credited and/or invoice allocated.' })
  @ApiResponse({ status: 403, description: 'Permission or step-up required' })
  @ApiResponse({ status: 404, description: 'Receipt not found' })
  @ApiResponse({ status: 409, description: 'Receipt is not awaiting confirmation' })
  async confirm(
    @Req() req: AuthenticatedRequest,
    @Param('transactionId') transactionId: string,
    @Body() body?: Record<string, unknown>,
  ): Promise<BankReceiptReviewDto> {
    this.assertConfirmPermission(req)
    assertUuid(transactionId)
    const parsed = parseOptionalInvoiceId(body ?? {})
    if (!parsed.ok) {
      httpError(ErrorCodes.VALIDATION_INPUT_INVALID.code, parsed.message, 400)
    }
    const correlationId = this.correlationId.getCorrelationId()
    return this.service.confirm({
      transactionId,
      actorUserId: req.session.userId,
      ip: requestIp(req),
      invoiceId: parsed.invoiceId,
      ...(correlationId ? { correlationId } : {}),
    })
  }

  @Post(':transactionId/reject')
  @HttpCode(200)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Reject a bank-receipt top-up with a customer-visible reason',
    description: 'Marks the Pending ledger row Rejected. Never credits the wallet.',
  })
  @ApiParam({ name: 'transactionId', format: 'uuid' })
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
  @ApiResponse({ status: 200, description: 'Receipt rejected; balance unchanged.' })
  @ApiResponse({ status: 400, description: 'Reason missing or invalid' })
  @ApiResponse({ status: 403, description: 'Permission or step-up required' })
  @ApiResponse({ status: 404, description: 'Receipt not found' })
  @ApiResponse({ status: 409, description: 'Receipt is not awaiting review' })
  async reject(
    @Req() req: AuthenticatedRequest,
    @Param('transactionId') transactionId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<BankReceiptReviewDto> {
    this.assertConfirmPermission(req)
    assertUuid(transactionId)
    const correlationId = this.correlationId.getCorrelationId()
    return this.service.reject({
      transactionId,
      raw: body,
      actorUserId: req.session.userId,
      ip: requestIp(req),
      ...(correlationId ? { correlationId } : {}),
    })
  }
}
