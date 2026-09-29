import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import { ErrorCodes } from '@barghsa/shared/errors';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { RequiresStepUp, StepUpGuard } from '../session/step-up.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { RefundService } from './refund.service.js';
import { refundUuid, refundRequestSchema, refundReviewSchema } from './refund-validation.js';
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
  @Get()
  @ApiOperation({
    summary: 'Read refundable invoice balance and its external bank refund requests',
  })
  @ApiQuery({ name: 'invoiceId', format: 'uuid' })
  @ApiQuery({ name: 'before', required: false, format: 'uuid' })
  async forInvoice(
    @Req() req: AuthenticatedRequest,
    @Query('invoiceId') invoiceId: string,
    @Query('before') before?: string
  ) {
    this.authorize(req);
    const id = refundUuid.safeParse(invoiceId),
      cursor = refundUuid.optional().safeParse(before);
    if (!id.success || !cursor.success)
      throw new HttpException({ error: ErrorCodes.VALIDATION_PARSE_ZOD.code }, 400);
    return this.refunds.refundsForInvoice(id.data, req.session, 'external_bank', cursor.data);
  }
  @Post('review')
  @HttpCode(200)
  @ApiOperation({ summary: 'Preview the authoritative bank refund request and confirmation hash' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['invoiceId', 'amount', 'reason'],
      properties: {
        invoiceId: { type: 'string', format: 'uuid' },
        amount: { type: 'string', pattern: '^[0-9]{1,19}$' },
        reason: { type: 'string', minLength: 1, maxLength: 1000 },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Authoritative refund review with confirmation hash' })
  async review(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    this.authorize(req);
    const parsed = refundReviewSchema.safeParse(body);
    if (!parsed.success)
      throw new HttpException({ error: ErrorCodes.VALIDATION_PARSE_ZOD.code }, 400);
    return this.refunds.reviewRequest(parsed.data, req.session, 'external_bank');
  }
  @Post()
  @RequiresStepUp()
  @ApiOperation({ summary: 'Request an invoice refund by external bank transfer' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['invoiceId', 'amount', 'idempotencyKey', 'reason', 'expectedReviewHash'],
      properties: {
        invoiceId: { type: 'string', format: 'uuid' },
        amount: {
          type: 'string',
          pattern: '^[0-9]{1,19}$',
          description: 'Positive exact int8 IRR',
        },
        idempotencyKey: { type: 'string', format: 'uuid' },
        reason: { type: 'string', minLength: 1, maxLength: 1000 },
        expectedReviewHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
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
