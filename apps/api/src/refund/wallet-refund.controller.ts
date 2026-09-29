import {
  Body,
  Controller,
  Get,
  Query,
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
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import {
  refundUuid,
  refundRequestSchema,
  refundReviewSchema,
  refundDecisionSchema,
  refundDecisionConfirmSchema,
} from './refund-validation.js';
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
  @Get('contract-obligations')
  @ApiOperation({ summary: 'List unresolved contract refund obligations for finance follow-up' })
  async obligations(@Req() req: AuthenticatedRequest, @Query('before') before?: string) {
    this.authorize(req);
    const parsed = refundUuid.optional().safeParse(before);
    if (!parsed.success)
      throw new HttpException({ error: ErrorCodes.VALIDATION_PARSE_ZOD.code }, 400);
    return this.refunds.contractObligations(parsed.data);
  }
  @Get()
  @ApiOperation({ summary: 'Read refundable invoice balance and its wallet refund requests' })
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
    return this.refunds.refundsForInvoice(id.data, req.session, 'wallet', cursor.data);
  }
  @Post('review')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Preview the authoritative wallet refund request and confirmation hash',
  })
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
    return this.refunds.reviewRequest(parsed.data, req.session, 'wallet');
  }
  @Post()
  @RequiresStepUp()
  @ApiOperation({ summary: 'Request an invoice refund to the customer wallet' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['invoiceId', 'amount', 'idempotencyKey', 'reason', 'expectedReviewHash'],
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
        expectedReviewHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
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
  @Post(':id/:action/review')
  @HttpCode(200)
  @ApiOperation({ summary: 'Preview the authoritative wallet refund decision' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'action', enum: ['approve', 'reject', 'cancel', 'process'] })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { reason: { type: 'string', minLength: 1, maxLength: 1000 } },
    },
  })
  @ApiResponse({ status: 200, description: 'Authoritative decision review and confirmation hash' })
  async reviewDecision(
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
    return this.refunds.reviewDecision(
      parsedId.data,
      parsedAction.data,
      parsedBody.data.reason,
      req.session,
      'wallet'
    );
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
      required: ['expectedReviewHash'],
      properties: {
        expectedReviewHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
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
      parsedBody = refundDecisionConfirmSchema.safeParse(body ?? {});
    if (!parsedId.success || !parsedAction.success || !parsedBody.success)
      throw new HttpException({ error: ErrorCodes.VALIDATION_PARSE_ZOD.code }, 400);
    return this.refunds.decide(
      parsedId.data,
      parsedAction.data,
      parsedBody.data.reason,
      req.session,
      req.ip ?? '127.0.0.1',
      'wallet',
      undefined,
      parsedBody.data.expectedReviewHash
    );
  }
}
