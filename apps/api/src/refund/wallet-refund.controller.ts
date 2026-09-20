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
import { refundUuid, refundRequestSchema, refundDecisionSchema } from './refund-validation.js';
import { ErrorCodes } from '@barghsa/shared/errors';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { RequiresStepUp, StepUpGuard } from '../session/step-up.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { RefundService } from './refund.service.js';
@ApiTags('Admin · Wallet refunds')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, StepUpGuard)
@Controller('api/admin/wallet-refunds')
export class WalletRefundController {
  constructor(private readonly refunds: RefundService) {}
  private authorize(req: AuthenticatedRequest) {
    if (!hasStaffPermission(req, 'admin:financial:edit'))
      throw new HttpException({ error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
  }
  @Post()
  @RequiresStepUp()
  @ApiOperation({ summary: 'Request an invoice refund to the customer wallet' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['invoiceId', 'amount', 'idempotencyKey', 'reason'],
      additionalProperties: false,
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
    description:
      'Refund request and optional financial approval request ID. Amount is a decimal string.',
  })
  async request(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    this.authorize(req);
    const parsed = refundRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new HttpException({ error: ErrorCodes.VALIDATION_PARSE_ZOD.code }, 400);
    return this.refunds.request(parsed.data, req.session, req.ip ?? '127.0.0.1');
  }
  @Post(':id/:action')
  @HttpCode(200)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Approve, reject, cancel or atomically process a wallet refund' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'action', enum: ['approve', 'reject', 'cancel', 'process'] })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reason: {
          type: 'string',
          minLength: 1,
          maxLength: 1000,
          description: 'Required for reject and cancel',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description:
      'Current refund state and bounded retry metadata. Processing intent is durable; Completed is returned only after ledger, invoice and notice commit. Failed includes the next due time or exhausted status.',
  })
  async decide(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() body: unknown
  ) {
    this.authorize(req);
    const parsedId = refundUuid.safeParse(id),
      parsedAction = z.enum(['approve', 'reject', 'cancel', 'process']).safeParse(action),
      parsedBody = refundDecisionSchema.safeParse(body ?? {});
    if (!parsedId.success || !parsedAction.success || !parsedBody.success)
      throw new HttpException({ error: ErrorCodes.VALIDATION_PARSE_ZOD.code }, 400);
    return this.refunds.decide(
      parsedId.data,
      parsedAction.data,
      parsedBody.data.reason,
      req.session,
      req.ip ?? '127.0.0.1'
    );
  }
}
