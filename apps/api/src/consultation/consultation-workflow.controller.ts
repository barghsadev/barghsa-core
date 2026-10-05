import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { ConsultationWorkflowService } from './consultation-workflow.service.js';
import { CONSULTATION_STATUSES } from './consultation-state.js';
import { InputFieldException } from '../common/input-field.exception.js';
import { hasStaffPermission } from '../session/staff-permissions.js';

import { parseConsultationFeeInput } from './consultation-fee-input-fields.js';

const assignment = z.discriminatedUnion('assignTo', [
  z.object({ assignTo: z.literal('self') }).strict(),
  z.object({ assignTo: z.literal('team'), team: z.string().trim().min(1).max(80) }).strict(),
]);
const reason = z.object({ reason: z.string().trim().min(1).max(2000) }).strict();
const optionalReason = z.object({ reason: z.string().trim().min(1).max(2000).optional() }).strict();
const reviewHash = z.string().regex(/^[a-f0-9]{64}$/);
const offerReview = z.object({ decision: z.enum(['accept', 'decline']) }).strict();
const acceptOffer = z.object({ expectedReviewHash: reviewHash }).strict();
const declineOffer = optionalReason.extend({ expectedReviewHash: reviewHash });
const feeOffer = z
  .object({
    idempotencyKey: z.string().uuid(),
    fee: z
      .string()
      .regex(/^[1-9][0-9]{0,18}$/)
      .refine(
        (value) => /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n
      ),
    scope: z.string().trim().min(1).max(4000),
    deliverables: z.string().trim().min(1).max(4000),
    validUntil: z.iso.datetime({ offset: true }),
    reason: z.string().trim().min(1).max(2000).optional(),
    expectedReviewHash: reviewHash,
  })
  .strict();
const feeReviewInput = feeOffer.omit({ idempotencyKey: true, expectedReviewHash: true });
const paidFeeAdjustment = z
  .object({
    idempotencyKey: z.string().uuid(),
    fee: z
      .string()
      .regex(/^[1-9][0-9]{0,18}$/)
      .refine(
        (value) => /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n
      ),
    reason: z.string().trim().min(1).max(1000),
    validUntil: z.iso.datetime({ offset: true }),
    expectedReviewHash: reviewHash,
  })
  .strict();
const paidFeeReviewInput = paidFeeAdjustment.omit({
  idempotencyKey: true,
  expectedReviewHash: true,
});
const paidClosure = z
  .object({
    idempotencyKey: z.string().uuid(),
    reason: z.string().trim().min(1).max(1000),
    expectedReviewHash: reviewHash,
  })
  .strict();
const paidResolutionInput = z
  .object({
    action: z.enum(['cancel', 'reject', 'recover_refund']),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
const empty = z.object({}).strict();
const status = z.enum(CONSULTATION_STATUSES);
function parse<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new BadRequestException('Invalid consultation action');
  return parsed.data as z.output<S>;
}
function parseReason(body: unknown): z.output<typeof reason> {
  const parsed = reason.safeParse(body);
  if (parsed.success) return parsed.data;
  if (
    parsed.error.issues.length &&
    parsed.error.issues.every(
      (issue) =>
        issue.path.length === 1 &&
        issue.path[0] === 'reason' &&
        ['invalid_type', 'too_small', 'too_big'].includes(issue.code)
    )
  )
    throw new InputFieldException(['reason']);
  throw new BadRequestException('Invalid consultation action');
}
function requireFormPermission(req: AuthenticatedRequest) {
  if (!hasStaffPermission(req, 'orders:write')) throw new ForbiddenException('Permission denied');
}

@ApiTags('Admin · Consultations')
@ApiBearerAuth()
@Controller('api/admin/consultations')
@UseGuards(SessionAuthGuard)
export class StaffConsultationWorkflowController {
  constructor(private readonly workflow: ConsultationWorkflowService) {}

  @Get('teams')
  @ApiOperation({ summary: 'List active teams available for consultation assignment' })
  teams(@Req() req: AuthenticatedRequest) {
    return this.workflow.teams(req.session);
  }

  @Get('requests')
  @ApiOperation({ summary: 'List consultation work by status and assignment' })
  @ApiQuery({ name: 'status', required: false, enum: CONSULTATION_STATUSES })
  @ApiQuery({ name: 'assignment', required: false, enum: ['all', 'mine', 'unassigned'] })
  @ApiQuery({ name: 'priority', required: false, enum: ['all', 'high', 'normal'] })
  @ApiQuery({ name: 'minAgeDays', required: false, enum: ['0', '1', '7'] })
  @ApiQuery({ name: 'after', required: false, format: 'uuid', type: String })
  queue(
    @Req() req: AuthenticatedRequest,
    @Query('status') rawStatus?: string,
    @Query('assignment') rawAssignment?: string,
    @Query('priority') rawPriority?: string,
    @Query('minAgeDays') rawAge?: string,
    @Query('after') rawAfter?: string
  ) {
    const parsedStatus = rawStatus ? status.safeParse(rawStatus) : null;
    const parsedAssignment = z
      .enum(['all', 'mine', 'unassigned'])
      .safeParse(rawAssignment ?? 'all');
    const parsedPriority = z.enum(['all', 'high', 'normal']).safeParse(rawPriority ?? 'all');
    const parsedAge = z.enum(['0', '1', '7']).safeParse(rawAge ?? '0');
    if (
      (parsedStatus && !parsedStatus.success) ||
      !parsedAssignment.success ||
      !parsedPriority.success ||
      !parsedAge.success ||
      (rawAfter !== undefined && !z.string().uuid().safeParse(rawAfter).success)
    )
      throw new BadRequestException('Invalid consultation filter');
    return this.workflow.queue(
      req.session,
      parsedStatus?.data,
      parsedAssignment.data,
      parsedPriority.data,
      Number(parsedAge.data),
      rawAfter
    );
  }

  @Get('requests/:id')
  @ApiOperation({ summary: 'Read consultation details and status history for staff' })
  detail(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    return this.workflow.detail(req.session, id);
  }

  @Post('requests/:id/assign')
  @HttpCode(200)
  @ApiOperation({ summary: 'Assign a consultation to self or an active staff team' })
  @ApiZodBody(assignment)
  assign(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    return this.workflow.assign(req.session, id, parse(assignment, body), req.ip ?? '127.0.0.1');
  }

  @Post('requests/:id/review')
  @HttpCode(200)
  @ApiOperation({ summary: 'Start reviewing a submitted consultation request' })
  @ApiZodBody(empty)
  review(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    parse(empty, body);
    return this.workflow.staffAction(req.session, id, 'review', undefined, req.ip ?? '127.0.0.1');
  }

  @Post('requests/:id/fee')
  @HttpCode(200)
  @ApiOperation({ summary: 'Issue or replace a consultation fee offer and invoice' })
  @ApiZodBody(feeOffer)
  async setFee(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    requireFormPermission(req);
    const input = await parseConsultationFeeInput(
      feeOffer,
      body,
      ['fee', 'scope', 'deliverables', 'validUntil', 'reason'],
      () => this.workflow.assertCanEditFee(req.session, id, false, true)
    );
    return this.workflow.setFee(req.session, id, input, req.ip ?? '127.0.0.1');
  }

  @Post('requests/:id/fee-review')
  @HttpCode(200)
  @ApiOperation({ summary: 'Preview the authoritative consultation fee offer and invoice outcome' })
  @ApiZodBody(feeReviewInput)
  async feeReview(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    requireFormPermission(req);
    const input = await parseConsultationFeeInput(
      feeReviewInput,
      body,
      ['fee', 'scope', 'deliverables', 'validUntil', 'reason'],
      () => this.workflow.assertCanEditFee(req.session, id, false, false)
    );
    return this.workflow.feeReview(req.session, id, input);
  }

  @Post('requests/:id/paid-fee')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Adjust an accepted paid consultation fee with a charge or credit and refund request',
  })
  @ApiZodBody(paidFeeAdjustment)
  async adjustPaidFee(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    requireFormPermission(req);
    const input = await parseConsultationFeeInput(
      paidFeeAdjustment,
      body,
      ['fee', 'validUntil', 'reason'],
      () => this.workflow.assertCanEditFee(req.session, id, true, true)
    );
    return this.workflow.adjustPaidFee(req.session, id, input, req.ip ?? '127.0.0.1');
  }

  @Post('requests/:id/paid-fee-review')
  @HttpCode(200)
  @ApiOperation({ summary: 'Preview the paid consultation charge or credit and refund allocation' })
  @ApiZodBody(paidFeeReviewInput)
  async paidFeeReview(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    requireFormPermission(req);
    const input = await parseConsultationFeeInput(
      paidFeeReviewInput,
      body,
      ['fee', 'validUntil', 'reason'],
      () => this.workflow.assertCanEditFee(req.session, id, true, false)
    );
    return this.workflow.paidFeeReview(req.session, id, input);
  }

  @Post('requests/:id/paid-cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a paid consultation and request wallet refunds' })
  @ApiZodBody(paidClosure)
  async paidCancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    requireFormPermission(req);
    const input = await parseConsultationFeeInput(paidClosure, body, ['reason'], () =>
      this.workflow.assertCanEditPaidResolution(req.session, id, false, true)
    );
    return this.workflow.closePaid(req.session, id, 'cancel', input, req.ip ?? '127.0.0.1');
  }

  @Post('requests/:id/paid-resolution-review')
  @HttpCode(200)
  @ApiOperation({ summary: 'Preview paid consultation closure or wallet refund recovery' })
  @ApiZodBody(paidResolutionInput)
  async paidResolutionReview(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    requireFormPermission(req);
    const input = await parseConsultationFeeInput(paidResolutionInput, body, ['reason'], () =>
      this.workflow.assertCanEditPaidResolution(
        req.session,
        id,
        typeof body === 'object' &&
          body !== null &&
          'action' in body &&
          body.action === 'recover_refund',
        false
      )
    );
    return this.workflow.paidResolutionReview(req.session, id, input);
  }

  @Post('requests/:id/paid-reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject a paid consultation and request wallet refunds' })
  @ApiZodBody(paidClosure)
  async paidReject(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    requireFormPermission(req);
    const input = await parseConsultationFeeInput(paidClosure, body, ['reason'], () =>
      this.workflow.assertCanEditPaidResolution(req.session, id, false, true)
    );
    return this.workflow.closePaid(req.session, id, 'reject', input, req.ip ?? '127.0.0.1');
  }

  @Post('requests/:id/refund-recovery')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Request an uncovered consultation credit refund without issuing another credit',
  })
  @ApiZodBody(paidClosure)
  async refundRecovery(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    requireFormPermission(req);
    const input = await parseConsultationFeeInput(paidClosure, body, ['reason'], () =>
      this.workflow.assertCanEditPaidResolution(req.session, id, true, true)
    );
    return this.workflow.recoverRefund(req.session, id, input, req.ip ?? '127.0.0.1');
  }

  @Post('requests/:id/request-info')
  @HttpCode(200)
  @ApiOperation({ summary: 'Request more information from the consultation customer' })
  @ApiZodBody(reason)
  requestInfo(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    requireFormPermission(req);
    return this.workflow.staffAction(
      req.session,
      id,
      'request-info',
      parseReason(body).reason,
      req.ip ?? '127.0.0.1'
    );
  }

  @Post('requests/:id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject a consultation request with a reason' })
  @ApiZodBody(reason)
  reject(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    requireFormPermission(req);
    return this.workflow.staffAction(
      req.session,
      id,
      'reject',
      parseReason(body).reason,
      req.ip ?? '127.0.0.1'
    );
  }

  @Post('requests/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a consultation request with a reason' })
  @ApiZodBody(reason)
  cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    requireFormPermission(req);
    return this.workflow.staffAction(
      req.session,
      id,
      'cancel',
      parseReason(body).reason,
      req.ip ?? '127.0.0.1'
    );
  }

  @Post('requests/:id/complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark a paid and accepted consultation completed' })
  @ApiZodBody(reason)
  complete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    requireFormPermission(req);
    return this.workflow.staffAction(
      req.session,
      id,
      'complete',
      parseReason(body).reason,
      req.ip ?? '127.0.0.1'
    );
  }
}

@ApiTags('Consultation requests')
@ApiBearerAuth()
@Controller('api/consultations')
@UseGuards(SessionAuthGuard)
export class CustomerConsultationWorkflowController {
  constructor(private readonly workflow: ConsultationWorkflowService) {}

  @Post('requests/:id/offer-review')
  @HttpCode(200)
  @ApiOperation({ summary: 'Review the current consultation offer and decision outcome' })
  @ApiZodBody(offerReview)
  offerReview(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    return this.workflow.customerDecisionReview(req.session, id, parse(offerReview, body).decision);
  }

  @Post('requests/:id/provide-info')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Provide requested information and return the consultation to staff review',
  })
  @ApiZodBody(reason)
  provideInfo(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    return this.workflow.provideInfo(
      req.session,
      id,
      parseReason(body).reason,
      req.ip ?? '127.0.0.1'
    );
  }

  @Post('requests/:id/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accept a consultation offer and proceed to its invoice payment' })
  @ApiZodBody(acceptOffer)
  accept(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    const parsed = parse(acceptOffer, body);
    return this.workflow.customerDecision(
      req.session,
      id,
      'accept',
      undefined,
      req.ip ?? '127.0.0.1',
      parsed.expectedReviewHash
    );
  }

  @Post('requests/:id/decline')
  @HttpCode(200)
  @ApiOperation({ summary: 'Decline a consultation offer and cancel its unpaid invoice' })
  @ApiZodBody(declineOffer)
  decline(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    const parsed = parse(declineOffer, body);
    return this.workflow.customerDecision(
      req.session,
      id,
      'decline',
      parsed.reason,
      req.ip ?? '127.0.0.1',
      parsed.expectedReviewHash
    );
  }
}
