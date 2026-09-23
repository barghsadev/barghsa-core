import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { RequiresStepUp, StepUpGuard } from '../session/step-up.guard.js';
import {
  SAVING_STAGES,
  SavingFulfillmentService,
  type SavingStage,
  type StageAction,
} from './saving-fulfillment.service.js';

const review = z
  .object({ idempotencyKey: z.string().uuid(), expectedVersionId: z.string().uuid() })
  .strict();
const rejection = review.extend({ reason: z.string().trim().min(1).max(1000) }).strict();
const stageInput = z
  .object({
    idempotencyKey: z.string().uuid(),
    expectedStatus: z.literal('in_progress'),
    explanation: z.string().trim().min(1).max(1000),
    handoverDescription: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();
const addressAmendment = z
  .object({
    idempotencyKey: z.string().uuid(),
    expectedVersionId: z.string().uuid(),
    expectedAddressId: z.string().uuid(),
    addressId: z.string().uuid(),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
const hardwareAmendment = z
  .object({
    idempotencyKey: z.string().uuid(),
    expectedVersionId: z.string().uuid(),
    expectedHardwareId: z.string().uuid(),
    hardwareProductId: z.string().uuid(),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
  return result.data;
}

@ApiTags('Staff · Saving orders')
@Controller('api/staff/saving/orders')
@UseGuards(SessionAuthGuard, StepUpGuard)
export class SavingFulfillmentController {
  constructor(private readonly service: SavingFulfillmentService) {}

  private permission(req: AuthenticatedRequest, write: boolean) {
    if (
      !hasStaffPermission(req, write ? 'contracts:write' : 'contracts:read') &&
      !(write === false && hasStaffPermission(req, 'contracts:write'))
    )
      throw new HttpException({ error: 'AUTHZ:FORBIDDEN' }, 403);
  }

  @Get()
  @RateLimit({ namespace: 'saving:staff-queue:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Saving order review and fulfillment queue' })
  queue(@Req() req: AuthenticatedRequest) {
    this.permission(req, false);
    return this.service.queue();
  }

  @Get(':id')
  @RateLimit({ namespace: 'saving:staff-detail:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Saving order review detail and fulfillment history' })
  detail(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    this.permission(req, false);
    return this.service.detail(id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequiresStepUp()
  @RateLimit({ namespace: 'saving:staff-review:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Approve a saving request and publish its exact contract version' })
  @ApiZodBody(review)
  approve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    this.permission(req, true);
    return this.service.decide(
      id,
      'approve',
      parse(review, body),
      req.session,
      req.ip ?? 'unknown'
    );
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequiresStepUp()
  @RateLimit({ namespace: 'saving:staff-review:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Reject a saving request with reason and refund handling' })
  @ApiZodBody(rejection)
  reject(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    this.permission(req, true);
    return this.service.decide(
      id,
      'reject',
      parse(rejection, body),
      req.session,
      req.ip ?? 'unknown'
    );
  }

  @Post(':id/amend-address')
  @HttpCode(201)
  @RequiresStepUp()
  @RateLimit({ namespace: 'saving:staff-amend-address:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Record a paid saving order installation-address amendment' })
  @ApiZodBody(addressAmendment)
  amendAddress(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    this.permission(req, true);
    return this.service.amendAddress(
      id,
      parse(addressAmendment, body),
      req.session,
      req.ip ?? 'unknown'
    );
  }

  @Post(':id/amend-hardware')
  @HttpCode(201)
  @RequiresStepUp()
  @RateLimit({ namespace: 'saving:staff-amend-hardware:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Swap equally priced hardware on a paid order before delivery' })
  @ApiZodBody(hardwareAmendment)
  amendHardware(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    this.permission(req, true);
    return this.service.amendHardware(
      id,
      parse(hardwareAmendment, body),
      req.session,
      req.ip ?? 'unknown'
    );
  }

  @Post(':id/stages/:stage/:action')
  @HttpCode(200)
  @RequiresStepUp()
  @RateLimit({ namespace: 'saving:stage-advance:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({
    summary: 'Complete a saving fulfillment stage or skip optional equipment handover',
  })
  @ApiZodBody(stageInput)
  advance(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('stage') stage: string,
    @Param('action') action: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    this.permission(req, true);
    if (!SAVING_STAGES.includes(stage as SavingStage) || !['complete', 'skip'].includes(action))
      throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    return this.service.advance(
      id,
      stage as SavingStage,
      action as StageAction,
      parse(stageInput, body),
      req.session,
      req.ip ?? 'unknown'
    );
  }
}
