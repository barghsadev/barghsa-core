import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ErrorCodes } from '@barghsa/shared/errors';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { RequiresStepUp, StepUpGuard } from '../session/step-up.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { contractUuid } from './contract-validation.js';
import {
  ContractCancellationRequestService,
  cancellationRequestSchema,
  rejectCancellationRequestSchema,
} from './contract-cancellation-request.service.js';
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new HttpException({ error: ErrorCodes.VALIDATION_PARSE_ZOD.code }, 400);
  return result.data;
}
function authorize(req: AuthenticatedRequest) {
  if (!hasStaffPermission(req, 'contracts:write'))
    throw new HttpException({ error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
}
const properties = {
  reason: { type: 'string' as const, minLength: 1, maxLength: 1000 },
  idempotencyKey: { type: 'string' as const, format: 'uuid' },
};
@ApiTags('Contracts')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, StepUpGuard)
@Controller('api/contracts/:id/cancellation-requests')
export class CustomerCancellationRequestController {
  constructor(private readonly service: ContractCancellationRequestService) {}
  @Get()
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Read the latest cancellation request and whether a new request is permitted',
  })
  get(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.service.customer(parse(contractUuid, id), req.session);
  }
  @Post()
  @RequiresStepUp()
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Request staff review of cancellation without changing contract or refund state',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['expectedVersionId', 'reason', 'preferredDestination', 'idempotencyKey'],
      properties: {
        ...properties,
        expectedVersionId: { type: 'string', format: 'uuid' },
        preferredDestination: { type: 'string', enum: ['wallet', 'external_bank'] },
      },
    },
  })
  submit(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.service.submit(
      parse(contractUuid, id),
      parse(cancellationRequestSchema, body),
      req.session,
      req.ip ?? '127.0.0.1'
    );
  }
}
@ApiTags('Admin · Contracts')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, StepUpGuard)
@Controller('api/admin')
export class StaffCancellationRequestController {
  constructor(private readonly service: ContractCancellationRequestService) {}
  @Get('contract-cancellation-requests')
  @ApiOperation({ summary: 'List pending customer cancellation requests for staff review' })
  @ApiQuery({
    name: 'before',
    required: false,
    type: String,
    description: 'Exclusive request UUID cursor; at most 50 records.',
  })
  queue(@Req() req: AuthenticatedRequest, @Query('before') before?: string) {
    authorize(req);
    return this.service.queue(before === undefined ? undefined : parse(contractUuid, before));
  }
  @Get('contracts/:id/cancellation-requests')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Read the latest customer request for a staff cancellation decision' })
  get(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    authorize(req);
    return this.service.staff(parse(contractUuid, id));
  }
  @Post('contract-cancellation-requests/:requestId/reject')
  @RequiresStepUp()
  @ApiParam({ name: 'requestId', format: 'uuid' })
  @ApiOperation({
    summary: 'Reject a pending cancellation request with an explanation; retain the contract',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['reason', 'idempotencyKey'],
      properties,
    },
  })
  reject(
    @Req() req: AuthenticatedRequest,
    @Param('requestId') requestId: string,
    @Body() body: unknown
  ) {
    authorize(req);
    return this.service.reject(
      parse(contractUuid, requestId),
      parse(rejectCancellationRequestSchema, body),
      req.session,
      req.ip ?? '127.0.0.1'
    );
  }
}
