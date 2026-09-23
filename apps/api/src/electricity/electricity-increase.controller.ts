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
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { RequiresStepUp, StepUpGuard } from '../session/step-up.guard.js';
import {
  ElectricityIncreaseService,
  approveIncreaseSchema,
  rejectIncreaseSchema,
  requestIncreaseSchema,
  signIncreaseSchema,
} from './electricity-increase.service.js';

const idSchema = z.string().uuid();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
  return parsed.data;
}

@ApiTags('Electricity contract changes')
@ApiBearerAuth()
@Controller('api/electricity/contracts/:id/increase')
@UseGuards(SessionAuthGuard, StepUpGuard)
export class CustomerElectricityIncreaseController {
  constructor(private readonly service: ElectricityIncreaseService) {}

  @Get()
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Read quantity increase eligibility and the one request for an electricity contract',
  })
  get(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.service.customer(parse(idSchema, id), req.session);
  }

  @Post()
  @RequiresStepUp()
  @RateLimit({ namespace: 'electricity:increase:user', limit: 10, windowMs: 60_000 })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Request a one-time future electricity quantity increase' })
  @ApiZodBody(requestIncreaseSchema)
  submit(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return this.service.submit(
      parse(idSchema, id),
      parse(requestIncreaseSchema, body),
      req.session,
      req.ip ?? '127.0.0.1'
    );
  }

  @Post('sign')
  @RequiresStepUp()
  @RateLimit({ namespace: 'electricity:increase-sign:user', limit: 10, windowMs: 60_000 })
  @ApiOperation({
    summary: 'Sign the approved increase amendment and issue its adjustment invoice',
  })
  @ApiZodBody(signIncreaseSchema)
  sign(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return this.service.sign(
      parse(idSchema, id),
      parse(signIncreaseSchema, body),
      req.session,
      req.ip ?? '127.0.0.1'
    );
  }
}

@ApiTags('Staff · Electricity contract changes')
@ApiBearerAuth()
@Controller('api/staff/electricity/increase-requests')
@UseGuards(SessionAuthGuard, StepUpGuard)
export class StaffElectricityIncreaseController {
  constructor(private readonly service: ElectricityIncreaseService) {}

  @Get()
  @ApiOperation({ summary: 'List pending or expired electricity quantity increase requests' })
  @ApiQuery({ name: 'before', required: false, format: 'uuid' })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'expired'] })
  queue(
    @Req() req: AuthenticatedRequest,
    @Query('before') before?: string,
    @Query('status') status?: string
  ) {
    if (!hasStaffPermission(req, 'contracts:read') && !hasStaffPermission(req, 'contracts:write'))
      throw new HttpException({ error: 'AUTHZ:FORBIDDEN' }, 403);
    return this.service.queue(
      before === undefined ? undefined : parse(idSchema, before),
      status === undefined ? 'pending' : parse(z.enum(['pending', 'expired']), status)
    );
  }

  @Post(':requestId/approve')
  @RequiresStepUp()
  @RateLimit({ namespace: 'electricity:increase-review:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Approve a pending increase and issue its immutable digital amendment' })
  @ApiZodBody(approveIncreaseSchema)
  approve(
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    if (!hasStaffPermission(req, 'contracts:write'))
      throw new HttpException({ error: 'AUTHZ:FORBIDDEN' }, 403);
    return this.service.approve(
      parse(idSchema, requestId),
      parse(approveIncreaseSchema, body),
      req.session,
      req.ip ?? '127.0.0.1'
    );
  }

  @Post(':requestId/reject')
  @RequiresStepUp()
  @RateLimit({ namespace: 'electricity:increase-review:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Reject a pending increase request with an explanation' })
  @ApiZodBody(rejectIncreaseSchema)
  reject(
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    if (!hasStaffPermission(req, 'contracts:write'))
      throw new HttpException({ error: 'AUTHZ:FORBIDDEN' }, 403);
    return this.service.reject(
      parse(idSchema, requestId),
      parse(rejectIncreaseSchema, body),
      req.session,
      req.ip ?? '127.0.0.1'
    );
  }
}
