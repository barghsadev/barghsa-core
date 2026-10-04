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
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { SolarPostalService, type SolarPostalStaffLane } from './solar-postal.service.js';
import { SolarPostalTrackingService } from './solar-postal-tracking.service.js';
import {
  solarPostalTrackingCommand,
  confirmedSolarPostalTrackingCommand,
} from './solar-postal-tracking.validation.js';
import { InputFieldException } from '../common/input-field.exception.js';
import { hasStaffPermission } from '../session/staff-permissions.js';

const guidance = z
  .object({
    fa: z.string().trim().min(1).max(4000),
    en: z.string().trim().min(1).max(4000),
    destinationAddress: z.string().trim().max(2000),
    contactDetails: z.string().trim().max(1000),
    originals: z
      .array(
        z
          .object({ fa: z.string().trim().min(1).max(200), en: z.string().trim().min(1).max(200) })
          .strict()
      )
      .max(30),
  })
  .strict();
const shipment = z
  .object({
    courier: z.string().trim().min(1).max(100),
    trackingNumber: z.string().trim().min(1).max(200),
    sendDate: z.iso.date(),
    receiptImageId: z.string().uuid().optional(),
  })
  .strict();
const issue = z.object({ reason: z.string().trim().min(1).max(1000) }).strict();
const reviewHash = z.string().regex(/^[a-f0-9]{64}$/);
const confirmedIssue = issue.safeExtend({ expectedReviewHash: reviewHash });
const confirmedReceipt = z.object({ expectedReviewHash: reviewHash }).strict();
const postalDecisionReview = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('received'), reason: issue.shape.reason.optional() }).strict(),
  issue.safeExtend({ decision: z.literal('incomplete') }),
  issue.safeExtend({ decision: z.literal('not_received') }),
]);
function parse<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestException('Invalid postal request');
  return result.data as z.output<S>;
}

/** Project only editable public fields, never validator messages or protected paths. */
function parseForm<S extends z.ZodType>(
  schema: S,
  body: unknown,
  family: 'shipment' | 'guidance' | 'reason'
): z.output<S> {
  const result = schema.safeParse(body);
  if (result.success) return result.data as z.output<S>;
  const fields: string[] = [];
  for (const error of result.error.issues) {
    const path = error.path;
    if (!['invalid_type', 'too_small', 'too_big', 'invalid_format'].includes(error.code))
      throw new BadRequestException('Invalid postal request');
    if (
      path.length === 1 &&
      ((family === 'reason' && path[0] === 'reason') ||
        (family === 'shipment' &&
          ['courier', 'trackingNumber', 'sendDate', 'receiptImageId'].includes(String(path[0]))) ||
        (family === 'guidance' &&
          ['fa', 'en', 'destinationAddress', 'contactDetails'].includes(String(path[0]))))
    )
      fields.push(String(path[0]));
    else if (family === 'guidance' && path[0] === 'originals') {
      if (path.length === 1 && error.code === 'too_big') fields.push('originalsFa', 'originalsEn');
      else if (
        path.length === 3 &&
        typeof path[1] === 'number' &&
        (path[2] === 'fa' || path[2] === 'en')
      )
        fields.push(path[2] === 'fa' ? 'originalsFa' : 'originalsEn');
      else throw new BadRequestException('Invalid postal request');
    } else throw new BadRequestException('Invalid postal request');
  }
  if (!fields.length) throw new BadRequestException('Invalid postal request');
  throw new InputFieldException(fields);
}
function requireFormPermission(req: AuthenticatedRequest, permission: string) {
  if (!hasStaffPermission(req, permission)) throw new ForbiddenException('Permission denied');
}

@ApiTags('Solar postal documents')
@ApiBearerAuth()
@Controller('api/solar')
@UseGuards(SessionAuthGuard)
export class SolarPostalController {
  constructor(private readonly service: SolarPostalService) {}

  @Get('postal-guidance')
  @ApiOperation({ summary: 'Read postal destination and original-document guidance' })
  guidance() {
    return this.service.guidance();
  }

  @Get('requests/:id/postal')
  @ApiOperation({ summary: 'Read postal shipment state for a solar request' })
  state(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    return this.service.customerState(req.session, id);
  }

  @Post('requests/:id/postal/shipment')
  @HttpCode(200)
  @RateLimit({ namespace: 'solar:postal:shipment', limit: 10, windowMs: 60_000 })
  @ApiOperation({
    summary: 'Record customer courier, tracking, send date and optional receipt image',
  })
  @ApiZodBody(shipment)
  shipment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    return this.service.shipment(
      req.session,
      id,
      parseForm(shipment, body, 'shipment'),
      req.ip ?? '127.0.0.1'
    );
  }
}

@ApiTags('Admin · Solar postal documents')
@ApiBearerAuth()
@Controller('api/admin/solar')
@UseGuards(SessionAuthGuard)
export class StaffSolarPostalController {
  constructor(
    private readonly service: SolarPostalService,
    private readonly tracking: SolarPostalTrackingService
  ) {}

  @Get('requests/:id/postal/tracking')
  @ApiOperation({ summary: 'Read staff shipment arrival estimate and tracking page' })
  trackingState(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    return this.tracking.read(req.session, id);
  }

  @Post('requests/:id/postal/tracking/review')
  @HttpCode(200)
  @RateLimit({
    namespace: 'solar:postal:tracking-review',
    limit: 30,
    windowMs: 60_000,
    scope: 'user',
  })
  @ApiOperation({ summary: 'Review a customer-visible arrival estimate and tracking page update' })
  @ApiZodBody(solarPostalTrackingCommand)
  trackingReview(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown
  ) {
    return this.tracking.review(req.session, id, parse(solarPostalTrackingCommand, body));
  }

  @Post('requests/:id/postal/tracking')
  @HttpCode(200)
  @RateLimit({
    namespace: 'solar:postal:tracking-record',
    limit: 15,
    windowMs: 60_000,
    scope: 'user',
  })
  @ApiOperation({
    summary: 'Record a reviewed arrival estimate and tracking page without confirming receipt',
  })
  @ApiZodBody(confirmedSolarPostalTrackingCommand)
  trackingRecord(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown
  ) {
    return this.tracking.record(
      req.session,
      id,
      parse(confirmedSolarPostalTrackingCommand, body),
      req.ip ?? '127.0.0.1'
    );
  }

  @Get('postal-guidance')
  @ApiOperation({ summary: 'Read editable postal guidance' })
  guidance() {
    return this.service.guidance();
  }

  @Put('postal-guidance')
  @ApiOperation({ summary: 'Edit postal address, contact and original-document guidance' })
  @ApiZodBody(guidance)
  setGuidance(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    requireFormPermission(req, 'admin:catalogue:edit');
    return this.service.setGuidance(
      req.session,
      parseForm(guidance, body, 'guidance'),
      req.ip ?? '127.0.0.1'
    );
  }

  @Get('postal-queue')
  @ApiOperation({ summary: 'List solar requests in the postal stage' })
  @ApiQuery({ name: 'before', required: false, format: 'uuid' })
  @ApiQuery({ name: 'lane', required: false, enum: ['all', 'needs_staff', 'waiting_customer'] })
  queue(
    @Req() req: AuthenticatedRequest,
    @Query('before') before?: string,
    @Query('lane') lane?: string
  ) {
    if (before && !z.string().uuid().safeParse(before).success)
      throw new BadRequestException('Invalid solar postal cursor');
    if (lane && !z.enum(['all', 'needs_staff', 'waiting_customer']).safeParse(lane).success)
      throw new BadRequestException('Invalid solar postal lane');
    return this.service.staffQueue(req.session, before, (lane ?? 'all') as SolarPostalStaffLane);
  }

  @Post('requests/:id/postal/confirm-received')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm receipt of postal originals' })
  @ApiZodBody(confirmedReceipt)
  received(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    return this.service.decide(
      req.session,
      id,
      'received',
      undefined,
      parse(confirmedReceipt, body).expectedReviewHash,
      req.ip ?? '127.0.0.1'
    );
  }

  @Post('requests/:id/postal/review')
  @HttpCode(200)
  @ApiOperation({ summary: 'Review the current shipment before a staff postal decision' })
  @ApiZodBody(postalDecisionReview)
  reviewDecision(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    requireFormPermission(req, 'orders:write');
    const input = parseForm(postalDecisionReview, body, 'reason');
    return this.service.reviewDecision(req.session, id, input.decision, input.reason);
  }

  @Post('requests/:id/postal/mark-incomplete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark postal originals incomplete with a reason' })
  @ApiZodBody(confirmedIssue)
  incomplete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    requireFormPermission(req, 'orders:write');
    const input = parseForm(confirmedIssue, body, 'reason');
    return this.service.decide(
      req.session,
      id,
      'incomplete',
      input.reason,
      input.expectedReviewHash,
      req.ip ?? '127.0.0.1'
    );
  }

  @Post('requests/:id/postal/mark-not-received')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark postal originals not received with a reason' })
  @ApiZodBody(confirmedIssue)
  notReceived(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    requireFormPermission(req, 'orders:write');
    const input = parseForm(confirmedIssue, body, 'reason');
    return this.service.decide(
      req.session,
      id,
      'not_received',
      input.reason,
      input.expectedReviewHash,
      req.ip ?? '127.0.0.1'
    );
  }
}
