import { Body, Controller, Get, HttpException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ErrorCodes } from '@barghsa/shared/errors';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { RequiresStepUp, StepUpGuard } from '../session/step-up.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { ContractCancellationService } from './contract-cancellation.service.js';
import { contractUuid } from './contract-validation.js';
import {
  prepareCancellationSchema,
  executeCancellationSchema,
} from './contract-cancellation-validation.js';

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new HttpException({ error: ErrorCodes.VALIDATION_PARSE_ZOD.code }, 400);
  return result.data;
}

@ApiTags('Admin · Contracts')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, StepUpGuard)
@Controller('api/admin/contracts/:id/cancellations')
export class ContractCancellationController {
  constructor(private readonly service: ContractCancellationService) {}

  private authorize(req: AuthenticatedRequest) {
    if (!hasStaffPermission(req, 'contracts:write'))
      throw new HttpException({ error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
  }

  @Post()
  @RequiresStepUp()
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Prepare an immutable cancellation decision and any required financial approval',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'expectedVersionId',
        'expectedFingerprint',
        'reason',
        'refundDecision',
        'idempotencyKey',
      ],
      properties: {
        expectedVersionId: { type: 'string', format: 'uuid' },
        expectedFingerprint: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        reason: { type: 'string', minLength: 1, maxLength: 1000 },
        idempotencyKey: { type: 'string', format: 'uuid' },
        refundDecision: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              required: ['mode'],
              properties: { mode: { type: 'string', enum: ['full_wallet'] } },
            },
            {
              type: 'object',
              additionalProperties: false,
              required: ['mode', 'refunds'],
              properties: {
                mode: { type: 'string', enum: ['custom'] },
                refunds: {
                  type: 'array',
                  maxItems: 500,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['invoiceId', 'amount', 'destination'],
                    properties: {
                      invoiceId: { type: 'string', format: 'uuid' },
                      amount: { type: 'string', pattern: '^[1-9][0-9]{0,18}$' },
                      destination: { type: 'string', enum: ['wallet', 'external_bank'] },
                    },
                  },
                },
              },
            },
          ],
        },
      },
    },
  })
  prepare(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    this.authorize(req);
    return this.service.prepare(
      parse(contractUuid, id),
      parse(prepareCancellationSchema, body),
      req.session,
      req.ip ?? '127.0.0.1'
    );
  }

  @Get(':intentId')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'intentId', format: 'uuid' })
  @ApiOperation({
    summary: 'Read a prepared cancellation decision and its current approval status',
  })
  get(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('intentId') intentId: string
  ) {
    this.authorize(req);
    return this.service.get(parse(contractUuid, id), parse(contractUuid, intentId));
  }

  @Post('execute')
  @RequiresStepUp()
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary:
      'Execute a current approved cancellation decision and create its refund obligations atomically',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['intentId', 'idempotencyKey'],
      properties: {
        intentId: { type: 'string', format: 'uuid' },
        idempotencyKey: { type: 'string', format: 'uuid' },
      },
    },
  })
  execute(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    this.authorize(req);
    return this.service.execute(
      parse(contractUuid, id),
      parse(executeCancellationSchema, body),
      req.session,
      req.ip ?? '127.0.0.1'
    );
  }
}
