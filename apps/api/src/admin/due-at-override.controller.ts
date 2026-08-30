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
  DUE_AT_OVERRIDE_PERMISSION,
  DUE_AT_OVERRIDE_REASON_MAX_LENGTH,
} from '@barghsa/shared/finance'
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js'
import { StepUpGuard, RequiresStepUp } from '../session/step-up.guard.js'
import { CorrelationIdProvider } from '../common/correlation-id.middleware.js'
import {
  DueAtOverrideService,
  type InvoiceDueAtDto,
} from '../invoice/due-at-override.service.js'

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

function assertUuid(id: string, label = 'invoiceId'): void {
  const parsed = z.string().uuid('Expected a UUID').safeParse(id)
  if (!parsed.success) {
    httpError(ErrorCodes.VALIDATION_PARSE_ZOD.code, `Invalid ${label}: expected a UUID`, 400)
  }
}

/**
 * Staff dueAt override API (T-04.1.03.03 / S-04.1.03).
 *
 * Finance staff replace an invoice due date with an explicit datetime
 * and a required customer-visible reason. The reason is stored on the
 * invoice metadata snapshot and in the append-only audit log.
 *
 * Security:
 * - Every route requires an authenticated session with the
 *   `admin:finance:invoices:override-due-at` capability. Today the
 *   session model exposes only `req.session.isAdmin` (platform admin);
 *   granular staff-role permissions arrive with C-04.CC.03.
 * - The mutation additionally requires recent step-up verification
 *   (`@RequiresStepUp()`) — due-date changes are financial.
 */
@ApiTags('Admin · Invoice due dates')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/admin/invoices')
export class DueAtOverrideController {
  constructor(
    private readonly service: DueAtOverrideService,
    private readonly correlationId: CorrelationIdProvider,
  ) {}

  /** Single enforcement point for the override permission. */
  private assertOverridePermission(req: AuthenticatedRequest): void {
    if (!(req.session.isAdmin ?? false)) {
      httpError(
        ErrorCodes.AUTHZ_FORBIDDEN.code,
        `Admin role required (${DUE_AT_OVERRIDE_PERMISSION})`,
        HttpStatus.FORBIDDEN,
      )
    }
  }

  @Get(':invoiceId/due-at')
  @ApiOperation({
    summary: 'Get invoice due date (staff override UI)',
    description:
      'Returns issuedAt / dueAt / current override snapshot so staff can ' +
      'review before submitting a customer-visible due-date override.',
  })
  @ApiParam({ name: 'invoiceId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Current due-date snapshot.' })
  @ApiResponse({ status: 403, description: 'Override permission required' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  async get(
    @Req() req: AuthenticatedRequest,
    @Param('invoiceId') invoiceId: string,
  ): Promise<InvoiceDueAtDto> {
    this.assertOverridePermission(req)
    assertUuid(invoiceId)
    return this.service.get(invoiceId)
  }

  @Post(':invoiceId/due-at')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Override invoice dueAt (staff)',
    description:
      'Replaces invoices.due_at. Requires a customer-visible reason, which ' +
      'is stored in invoice metadata and the append-only audit log.',
  })
  @ApiParam({ name: 'invoiceId', format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['dueAt', 'reason'],
      properties: {
        dueAt: { type: 'string', format: 'date-time', example: '2026-09-15T08:00:00.000Z' },
        reason: {
          type: 'string',
          minLength: 1,
          maxLength: DUE_AT_OVERRIDE_REASON_MAX_LENGTH,
          description: 'Customer-visible reason for the override',
          example: 'Customer requested an extension after a billing delay',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Due date overridden.' })
  @ApiResponse({ status: 400, description: 'Validation failed (reason required, dueAt invalid)' })
  @ApiResponse({ status: 403, description: 'Override permission or step-up required' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  @ApiResponse({ status: 409, description: 'Invoice state does not allow override' })
  async override(
    @Req() req: AuthenticatedRequest,
    @Param('invoiceId') invoiceId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<InvoiceDueAtDto> {
    this.assertOverridePermission(req)
    assertUuid(invoiceId)
    const correlationId = this.correlationId.getCorrelationId()
    return this.service.override({
      invoiceId,
      raw: body,
      actorUserId: req.session.userId,
      ip: requestIp(req),
      ...(correlationId ? { correlationId } : {}),
    })
  }
}
