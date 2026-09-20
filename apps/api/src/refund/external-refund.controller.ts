import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import { ErrorCodes } from '@barghsa/shared/errors';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { RequiresStepUp, StepUpGuard } from '../session/step-up.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { RefundService } from './refund.service.js';
import { refundUuid, refundRequestSchema } from './refund-validation.js';
const decisionSchema = z
  .object({
    reason: z.string().trim().min(1).max(1000).optional(),
    bankReference: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
@ApiTags('Admin · External bank refunds')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, StepUpGuard)
@Controller('api/admin/external-refunds')
export class ExternalRefundController {
  constructor(private readonly refunds: RefundService) {}
  private authorize(req: AuthenticatedRequest) {
    if (!hasStaffPermission(req, 'admin:financial:edit'))
      throw new HttpException({ error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
  }
  @Post()
  @RequiresStepUp()
  @ApiOperation({ summary: 'Request an invoice refund by external bank transfer' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['invoiceId', 'amount', 'idempotencyKey', 'reason'],
      properties: {
        invoiceId: { type: 'string', format: 'uuid' },
        amount: {
          type: 'string',
          pattern: '^[0-9]{1,19}$',
          description: 'Positive exact int8 IRR',
        },
        idempotencyKey: { type: 'string', format: 'uuid' },
        reason: { type: 'string', minLength: 1, maxLength: 1000 },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Reserved external refund and optional financial approval request ID',
  })
  async request(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    this.authorize(req);
    const parsed = refundRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new HttpException({ error: ErrorCodes.VALIDATION_PARSE_ZOD.code }, 400);
    return this.refunds.request(parsed.data, req.session, req.ip ?? '127.0.0.1', 'external_bank');
  }
  @Post(':id/:action')
  @HttpCode(200)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Approve, reject, cancel, record a transfer or reconcile an external refund',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({
    name: 'action',
    enum: ['approve', 'reject', 'cancel', 'record-transfer', 'reconcile'],
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reason: {
          type: 'string',
          minLength: 1,
          maxLength: 1000,
          description: 'Required for reject/cancel',
        },
        bankReference: {
          type: 'string',
          minLength: 1,
          maxLength: 200,
          description:
            'Required for record-transfer and reconcile; reconciliation must match the recorded reference',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description:
      'Current refund state; a distinct finance staff member must reconcile the recorded transfer before completion',
  })
  async decide(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() body: unknown
  ) {
    this.authorize(req);
    const parsedId = refundUuid.safeParse(id),
      parsedAction = z
        .enum(['approve', 'reject', 'cancel', 'record-transfer', 'reconcile'])
        .safeParse(action),
      parsedBody = decisionSchema.safeParse(body ?? {});
    if (!parsedId.success || !parsedAction.success || !parsedBody.success)
      throw new HttpException({ error: ErrorCodes.VALIDATION_PARSE_ZOD.code }, 400);
    return this.refunds.decide(
      parsedId.data,
      parsedAction.data,
      parsedBody.data.reason,
      req.session,
      req.ip ?? '127.0.0.1',
      'external_bank',
      parsedBody.data.bankReference
    );
  }
}
