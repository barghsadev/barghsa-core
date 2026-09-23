import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { RequiresStepUp, StepUpGuard } from '../session/step-up.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import {
  ElectricityStaffReviewService,
  type StaffReviewAction,
} from './electricity-staff-review.service.js';

const baseInput = z
  .object({
    idempotencyKey: z.string().uuid(),
    expectedVersionId: z.string().uuid(),
  })
  .strict();
const reasonInput = baseInput.extend({ reason: z.string().trim().min(1).max(1000) }).strict();

@ApiTags('Staff · Electricity orders')
@Controller('api/staff/electricity/orders')
@UseGuards(SessionAuthGuard, StepUpGuard)
export class ElectricityStaffReviewController {
  constructor(private readonly service: ElectricityStaffReviewService) {}

  private requirePermission(req: AuthenticatedRequest, write: boolean) {
    if (
      !hasStaffPermission(req, write ? 'contracts:write' : 'contracts:read') &&
      !(write === false && hasStaffPermission(req, 'contracts:write'))
    )
      throw new HttpException({ error: 'AUTHZ:FORBIDDEN' }, 403);
  }

  @Get()
  @RateLimit({ namespace: 'electricity:staff-queue:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Oldest pending electricity orders for staff review' })
  @ApiQuery({ name: 'after', required: false, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Review work queue.' })
  queue(@Req() req: AuthenticatedRequest, @Query('after') after?: string) {
    this.requirePermission(req, false);
    if (after && !z.string().uuid().safeParse(after).success)
      throw new HttpException({ error: 'VALIDATION:INVALID_CURSOR' }, 400);
    return this.service.queue(after);
  }

  @Get('conversations')
  @RateLimit({ namespace: 'electricity:staff-conversations:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Recent electricity orders with customer or staff comments' })
  @ApiQuery({ name: 'after', required: false, format: 'uuid' })
  conversations(@Req() req: AuthenticatedRequest, @Query('after') after?: string) {
    this.requirePermission(req, false);
    if (after && !z.string().uuid().safeParse(after).success)
      throw new HttpException({ error: 'VALIDATION:INVALID_CURSOR' }, 400);
    return this.service.conversations(after);
  }

  @Get(':id')
  @RateLimit({ namespace: 'electricity:staff-detail:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Electricity order, contract and price snapshot for staff review' })
  @ApiResponse({ status: 200, description: 'Review detail.' })
  detail(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    this.requirePermission(req, false);
    return this.service.detail(id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequiresStepUp()
  @RateLimit({ namespace: 'electricity:staff-decision:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Approve the exact current preliminary electricity contract' })
  @ApiZodBody(baseInput)
  @ApiResponse({ status: 200, description: 'Order approved and customer notified.' })
  approve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    return this.decide(id, 'approve', body, req);
  }

  @Post(':id/request-changes')
  @HttpCode(200)
  @RequiresStepUp()
  @RateLimit({ namespace: 'electricity:staff-decision:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Request changes to an electricity order with a reason' })
  @ApiZodBody(reasonInput)
  @ApiResponse({ status: 200, description: 'Changes requested and customer notified.' })
  requestChanges(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    return this.decide(id, 'request-changes', body, req);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequiresStepUp()
  @RateLimit({ namespace: 'electricity:staff-decision:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Reject an order and create any required refund obligation' })
  @ApiZodBody(reasonInput)
  @ApiResponse({ status: 200, description: 'Order rejected and refund obligation queued if paid.' })
  reject(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    return this.decide(id, 'reject', body, req);
  }

  private decide(id: string, action: StaffReviewAction, body: unknown, req: AuthenticatedRequest) {
    this.requirePermission(req, true);
    const parsed = (action === 'approve' ? baseInput : reasonInput).safeParse(body);
    if (!parsed.success) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    return this.service.decide(id, action, parsed.data, req.session, req.ip ?? 'unknown');
  }
}
