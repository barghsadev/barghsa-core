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
import { WalletRefundService } from './wallet-refund.service.js';
const uuid = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const requestSchema = z
  .object({
    invoiceId: uuid,
    amount: z
      .string()
      .regex(/^\d{1,19}$/)
      .pipe(
        z.string().refine((value) => BigInt(value) > 0n && BigInt(value) <= 9223372036854775807n)
      ),
    idempotencyKey: uuid,
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
const decisionSchema = z.object({ reason: z.string().trim().min(1).max(1000).optional() }).strict();
@ApiTags('Admin · Wallet refunds')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, StepUpGuard)
@Controller('api/admin/wallet-refunds')
export class WalletRefundController {
  constructor(private readonly refunds: WalletRefundService) {}
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
    const parsed = requestSchema.safeParse(body);
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
      'Current refund state; processing returns Completed only after ledger credit and invoice transition commit.',
  })
  async decide(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() body: unknown
  ) {
    this.authorize(req);
    const parsedId = uuid.safeParse(id),
      parsedAction = z.enum(['approve', 'reject', 'cancel', 'process']).safeParse(action),
      parsedBody = decisionSchema.safeParse(body ?? {});
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
