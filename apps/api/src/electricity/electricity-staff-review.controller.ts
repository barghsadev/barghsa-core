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
import { ElectricityRawDraftService } from './electricity-raw-draft.service.js';
import { InputFieldException } from '../common/input-field.exception.js';
import {
  ElectricityStaffReviewService,
  type StaffReviewAction,
} from './electricity-staff-review.service.js';

const rawDraftReviewInput = z
  .object({ action: z.enum(['reject', 'cancel']), reason: z.string().trim().min(1).max(1000) })
  .strict();
const rawDraftTerminalInput = rawDraftReviewInput
  .extend({
    idempotencyKey: z.string().uuid(),
    expectedReviewHash: z.string().regex(/^[a-f0-9]{64}$/),
    approvalRequestId: z.string().uuid().optional(),
  })
  .strict();
const baseInput = z
  .object({
    idempotencyKey: z.string().uuid(),
    expectedVersionId: z.string().uuid(),
    expectedReviewHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const reasonInput = baseInput.extend({ reason: z.string().trim().min(1).max(1000) }).strict();
const previewInput = z
  .object({
    action: z.enum(['approve', 'request-changes', 'reject']),
    reason: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine((value) => (value.action === 'approve' ? !value.reason : !!value.reason), {
    path: ['reason'],
    message: 'A reason is required only for change requests and rejection',
  });

function parseReasonForm<S extends z.ZodType>(
  schema: S,
  body: unknown,
  editable: boolean
): z.output<S> {
  const result = schema.safeParse(body);
  if (result.success) return result.data as z.output<S>;
  if (
    editable &&
    result.error.issues.length &&
    result.error.issues.every(
      (issue) =>
        issue.path.length === 1 &&
        issue.path[0] === 'reason' &&
        ['invalid_type', 'too_small', 'too_big', 'custom'].includes(issue.code)
    )
  )
    throw new InputFieldException(['reason']);
  throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
}

@ApiTags('Staff · Electricity orders')
@Controller('api/staff/electricity/orders')
@UseGuards(SessionAuthGuard, StepUpGuard)
export class ElectricityStaffReviewController {
  constructor(
    private readonly service: ElectricityStaffReviewService,
    private readonly drafts: ElectricityRawDraftService
  ) {}

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
    return this.service.queue(req.session, after);
  }

  @Get('conversations')
  @RateLimit({ namespace: 'electricity:staff-conversations:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Recent electricity orders with customer or staff comments' })
  @ApiQuery({ name: 'after', required: false, format: 'uuid' })
  conversations(@Req() req: AuthenticatedRequest, @Query('after') after?: string) {
    this.requirePermission(req, false);
    if (after && !z.string().uuid().safeParse(after).success)
      throw new HttpException({ error: 'VALIDATION:INVALID_CURSOR' }, 400);
    return this.service.conversations(req.session, after);
  }

  @Get('drafts')
  @RateLimit({ namespace: 'electricity:raw-drafts:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({
    summary: 'List unlinked electricity draft records without saved wizard contents',
  })
  @ApiQuery({ name: 'after', required: false, format: 'uuid' })
  rawDrafts(@Req() req: AuthenticatedRequest, @Query('after') after?: string) {
    this.requirePermission(req, false);
    if (after && !z.string().uuid().safeParse(after).success)
      throw new HttpException({ error: 'VALIDATION:INVALID_CURSOR' }, 400);
    return this.drafts.queue(req.session, after);
  }

  @Post(':id/draft-terminal/review')
  @HttpCode(200)
  @RateLimit({ namespace: 'electricity:raw-draft-review:user', limit: 30, windowMs: 60_000 })
  @ApiOperation({ summary: 'Review rejection or cancellation of an unlinked electricity draft' })
  @ApiZodBody(rawDraftReviewInput)
  rawDraftReview(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown
  ) {
    this.requirePermission(req, true);
    const input = parseReasonForm(rawDraftReviewInput, body, true);
    return this.drafts.review(id, input.action, input.reason, req.session);
  }

  @Post(':id/draft-terminal')
  @HttpCode(200)
  @RequiresStepUp()
  @RateLimit({ namespace: 'electricity:raw-draft-end:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({
    summary:
      'End the exact reviewed contractless draft with full wallet returns and retained invoice and submission history',
  })
  @ApiZodBody(rawDraftTerminalInput)
  rawDraftTerminate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown
  ) {
    this.requirePermission(req, true);
    return this.drafts.terminate(
      id,
      parseReasonForm(rawDraftTerminalInput, body, true),
      req.session,
      req.ip ?? 'unknown'
    );
  }

  @Post(':id/draft-terminal/approval')
  @HttpCode(201)
  @RequiresStepUp()
  @RateLimit({ namespace: 'electricity:raw-draft-approval:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({
    summary: 'Prepare the exact second approval for contractless electricity draft termination',
  })
  @ApiZodBody(rawDraftTerminalInput.omit({ approvalRequestId: true }))
  rawDraftApproval(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown
  ) {
    this.requirePermission(req, true);
    return this.drafts.prepareApproval(
      id,
      parseReasonForm(rawDraftTerminalInput.omit({ approvalRequestId: true }), body, true),
      req.session,
      req.ip ?? 'unknown'
    );
  }

  @Get(':id')
  @RateLimit({ namespace: 'electricity:staff-detail:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Electricity order, contract and price snapshot for staff review' })
  @ApiResponse({ status: 200, description: 'Review detail.' })
  detail(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    this.requirePermission(req, false);
    return this.service.detail(id);
  }

  @Post(':id/financial-review')
  @HttpCode(200)
  @RateLimit({ namespace: 'electricity:staff-review-preview:user', limit: 30, windowMs: 60_000 })
  @ApiOperation({ summary: 'Preview the exact staff electricity decision and financial outcome' })
  @ApiZodBody(previewInput)
  @ApiResponse({ status: 200, description: 'Authoritative staff decision review.' })
  financialReview(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    this.requirePermission(req, true);
    const editable =
      !!body &&
      typeof body === 'object' &&
      'action' in body &&
      (body.action === 'request-changes' || body.action === 'reject');
    const parsed = parseReasonForm(previewInput, body, editable);
    return this.service.financialReview(
      id,
      parsed.action,
      parsed.reason?.trim() ?? '',
      req.session
    );
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
    const parsed = parseReasonForm(
      action === 'approve' ? baseInput : reasonInput,
      body,
      action !== 'approve'
    );
    return this.service.decide(id, action, parsed, req.session, req.ip ?? 'unknown');
  }
}
