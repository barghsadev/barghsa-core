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
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { RequiresStepUp, StepUpGuard } from '../session/step-up.guard.js';
import { parseSavingChangeInput } from './saving-change-input-fields.js';
import {
  SAVING_STAGES,
  SavingFulfillmentService,
  type SavingStage,
  type StageAction,
} from './saving-fulfillment.service.js';

const review = z
  .object({
    idempotencyKey: z.string().uuid(),
    expectedVersionId: z.string().uuid(),
    expectedReviewHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const rejection = review.extend({ reason: z.string().trim().min(1).max(1000) }).strict();
const decisionReviewInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), reason: z.literal('').default('') }).strict(),
  z.object({ action: z.literal('reject'), reason: z.string().trim().min(1).max(1000) }).strict(),
]);
const stageInput = z
  .object({
    idempotencyKey: z.string().uuid(),
    expectedStatus: z.literal('in_progress'),
    expectedReviewHash: z.string().regex(/^[a-f0-9]{64}$/),
    explanation: z.string().trim().min(1).max(1000),
    handoverDescription: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();
const stageReviewInput = stageInput
  .pick({ expectedStatus: true, explanation: true, handoverDescription: true })
  .strict();
const addressAmendment = z
  .object({
    idempotencyKey: z.string().uuid(),
    expectedVersionId: z.string().uuid(),
    expectedAddressId: z.string().uuid(),
    expectedReviewHash: z.string().regex(/^[a-f0-9]{64}$/),
    addressId: z.string().uuid(),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
const addressAmendmentReviewInput = addressAmendment
  .pick({ expectedVersionId: true, expectedAddressId: true, addressId: true, reason: true })
  .strict();
const hardwareAmendment = z
  .object({
    idempotencyKey: z.string().uuid(),
    expectedVersionId: z.string().uuid(),
    expectedHardwareId: z.string().uuid(),
    expectedReviewHash: z.string().regex(/^[a-f0-9]{64}$/),
    hardwareProductId: z.string().uuid(),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
const hardwareAmendmentReviewInput = hardwareAmendment
  .pick({
    expectedVersionId: true,
    expectedHardwareId: true,
    hardwareProductId: true,
    reason: true,
  })
  .strict();
const hardwareUpgradeCancellation = z
  .object({
    idempotencyKey: z.string().uuid(),
    upgradeId: z.string().uuid(),
    expectedReviewHash: z.string().regex(/^[a-f0-9]{64}$/),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
const hardwareUpgradeCancellationReviewInput = hardwareUpgradeCancellation
  .pick({ upgradeId: true, reason: true })
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
  @ApiQuery({ name: 'lane', required: false, enum: ['all', 'review', 'fulfillment'] })
  @ApiQuery({ name: 'after', required: false, format: 'uuid' })
  queue(
    @Req() req: AuthenticatedRequest,
    @Query('lane') lane?: string,
    @Query('after') after?: string
  ) {
    this.permission(req, false);
    return this.service.queue(
      req.session,
      lane ? parse(z.enum(['all', 'review', 'fulfillment']), lane) : 'all',
      after ? parse(z.string().uuid(), after) : undefined
    );
  }

  @Get(':id')
  @RateLimit({ namespace: 'saving:staff-detail:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Saving order review detail and fulfillment history' })
  detail(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    this.permission(req, false);
    return this.service.detail(id, hasStaffPermission(req, 'invoices:write'));
  }

  @Post(':id/financial-review')
  @HttpCode(200)
  @RateLimit({ namespace: 'saving:staff-financial-review:user', limit: 30, windowMs: 60_000 })
  @ApiOperation({
    summary: 'Preview exact contract, invoice and refund outcome before saving order decision',
  })
  @ApiZodBody(decisionReviewInput)
  async financialReview(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    this.permission(req, true);
    const rejecting =
      typeof body === 'object' && body !== null && 'action' in body && body.action === 'reject';
    const input = await parseSavingChangeInput(
      decisionReviewInput,
      body,
      rejecting ? ['reason'] : [],
      () => this.service.assertCanDecideOrAdvance(id, req.session, false, false)
    );
    return this.service.decisionReview(id, input.action, input.reason, req.session);
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
  async reject(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    this.permission(req, true);
    const input = await parseSavingChangeInput(rejection, body, ['reason'], () =>
      this.service.assertCanDecideOrAdvance(id, req.session, true, false)
    );
    return this.service.decide(id, 'reject', input, req.session, req.ip ?? 'unknown');
  }

  @Post(':id/amend-address-review')
  @HttpCode(200)
  @RateLimit({ namespace: 'saving:staff-amend-address-review:user', limit: 30, windowMs: 60_000 })
  @ApiOperation({ summary: 'Preview the paid saving order address amendment before confirmation' })
  @ApiZodBody(addressAmendmentReviewInput)
  async amendAddressReview(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    this.permission(req, true);
    const input = await parseSavingChangeInput(
      addressAmendmentReviewInput,
      body,
      ['addressId', 'reason'],
      () => this.service.assertCanAmendAddress(id, req.session, false)
    );
    return this.service.addressAmendmentReview(id, input, req.session);
  }

  @Post(':id/amend-address')
  @HttpCode(201)
  @RequiresStepUp()
  @RateLimit({ namespace: 'saving:staff-amend-address:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Record a paid saving order installation-address amendment' })
  @ApiZodBody(addressAmendment)
  async amendAddress(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    this.permission(req, true);
    const input = await parseSavingChangeInput(
      addressAmendment,
      body,
      ['addressId', 'reason'],
      () => this.service.assertCanAmendAddress(id, req.session, true)
    );
    return this.service.amendAddress(id, input, req.session, req.ip ?? 'unknown');
  }

  @Post(':id/amend-hardware-review')
  @HttpCode(200)
  @RateLimit({ namespace: 'saving:staff-amend-hardware-review:user', limit: 30, windowMs: 60_000 })
  @ApiOperation({ summary: 'Preview exact charge or credit before changing paid saving hardware' })
  @ApiZodBody(hardwareAmendmentReviewInput)
  async amendHardwareReview(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    this.permission(req, true);
    const allowPriceAdjustment = hasStaffPermission(req, 'invoices:write');
    const input = await parseSavingChangeInput(
      hardwareAmendmentReviewInput,
      body,
      ['hardwareProductId', 'reason'],
      () => this.service.assertCanAmendHardware(id, req.session, false, body, allowPriceAdjustment)
    );
    return this.service.hardwareAmendmentReview(id, input, req.session, allowPriceAdjustment);
  }

  @Post(':id/amend-hardware')
  @HttpCode(201)
  @RequiresStepUp()
  @RateLimit({ namespace: 'saving:staff-amend-hardware:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Swap paid hardware or issue a charge before a higher-priced swap' })
  @ApiZodBody(hardwareAmendment)
  async amendHardware(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    this.permission(req, true);
    const allowPriceAdjustment = hasStaffPermission(req, 'invoices:write');
    const input = await parseSavingChangeInput(
      hardwareAmendment,
      body,
      ['hardwareProductId', 'reason'],
      () => this.service.assertCanAmendHardware(id, req.session, true, body, allowPriceAdjustment)
    );
    return this.service.amendHardware(
      id,
      input,
      req.session,
      req.ip ?? 'unknown',
      allowPriceAdjustment
    );
  }

  @Post(':id/cancel-hardware-upgrade-review')
  @HttpCode(200)
  @RateLimit({ namespace: 'saving:staff-cancel-upgrade-review:user', limit: 30, windowMs: 60_000 })
  @ApiOperation({ summary: 'Preview unpaid charge and stock release before cancelling an upgrade' })
  @ApiZodBody(hardwareUpgradeCancellationReviewInput)
  async cancelHardwareUpgradeReview(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    this.permission(req, true);
    if (!hasStaffPermission(req, 'invoices:write'))
      throw new HttpException({ error: 'AUTHZ:FORBIDDEN' }, 403);
    const input = await parseSavingChangeInput(
      hardwareUpgradeCancellationReviewInput,
      body,
      ['reason'],
      () => this.service.assertCanCancelHardwareUpgrade(id, req.session, false, body)
    );
    return this.service.hardwareUpgradeCancellationReview(id, input, req.session);
  }

  @Post(':id/cancel-hardware-upgrade')
  @HttpCode(200)
  @RequiresStepUp()
  @RateLimit({ namespace: 'saving:staff-cancel-upgrade:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Cancel an unpaid hardware upgrade and release its reserved stock' })
  @ApiZodBody(hardwareUpgradeCancellation)
  async cancelHardwareUpgrade(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    this.permission(req, true);
    if (!hasStaffPermission(req, 'invoices:write'))
      throw new HttpException({ error: 'AUTHZ:FORBIDDEN' }, 403);
    const input = await parseSavingChangeInput(hardwareUpgradeCancellation, body, ['reason'], () =>
      this.service.assertCanCancelHardwareUpgrade(id, req.session, true, body)
    );
    return this.service.cancelHardwareUpgrade(id, input, req.session, req.ip ?? 'unknown');
  }

  @Post(':id/stages/:stage/:action/review')
  @HttpCode(200)
  @RateLimit({ namespace: 'saving:stage-review:user', limit: 30, windowMs: 60_000 })
  @ApiOperation({ summary: 'Preview the exact saving fulfillment stage transition' })
  @ApiZodBody(stageReviewInput)
  async advanceReview(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('stage') stage: string,
    @Param('action') action: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    this.permission(req, true);
    if (!SAVING_STAGES.includes(stage as SavingStage) || !['complete', 'skip'].includes(action))
      throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    const input = await parseSavingChangeInput(
      stageReviewInput,
      body,
      ['explanation', 'handoverDescription'],
      () => this.service.assertCanDecideOrAdvance(id, req.session, false, true)
    );
    return this.service.advanceReview(
      id,
      stage as SavingStage,
      action as StageAction,
      input,
      req.session
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
  async advance(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('stage') stage: string,
    @Param('action') action: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    this.permission(req, true);
    if (!SAVING_STAGES.includes(stage as SavingStage) || !['complete', 'skip'].includes(action))
      throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    const input = await parseSavingChangeInput(
      stageInput,
      body,
      ['explanation', 'handoverDescription'],
      () => this.service.assertCanDecideOrAdvance(id, req.session, true, true)
    );
    return this.service.advance(
      id,
      stage as SavingStage,
      action as StageAction,
      input,
      req.session,
      req.ip ?? 'unknown'
    );
  }
}
