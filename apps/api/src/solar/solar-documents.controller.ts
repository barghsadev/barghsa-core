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
import { SolarDocumentsService } from './solar-documents.service.js';
import { InputFieldException } from '../common/input-field.exception.js';
import { hasStaffPermission } from '../session/staff-permissions.js';

const guidance = z
  .object({
    fa: z.string().trim().min(1).max(4000),
    en: z.string().trim().min(1).max(4000),
    suggestions: z
      .array(
        z
          .object({ fa: z.string().trim().min(1).max(200), en: z.string().trim().min(1).max(200) })
          .strict()
      )
      .max(30),
  })
  .strict();
const complete = z.object({ allDocumentsUploaded: z.literal(true) }).strict();
const review = z
  .object({
    expectedRevision: z.number().int().positive(),
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();
const rejection = review.safeExtend({ reason: z.string().trim().min(1).max(1000) });
const additional = z.object({ description: z.string().trim().min(1).max(2000) }).strict();
const reviewHash = z.string().regex(/^[a-f0-9]{64}$/);
const confirmedAdditional = additional.safeExtend({ expectedReviewHash: reviewHash });
const confirmedAdvance = z.object({ expectedReviewHash: reviewHash }).strict();
const setDecisionReview = z.discriminatedUnion('decision', [
  additional.safeExtend({ decision: z.literal('request_additional') }),
  z
    .object({
      decision: z.literal('advance'),
      description: additional.shape.description.optional(),
    })
    .strict(),
]);
function parse<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestException('Invalid solar document request');
  return result.data as z.output<S>;
}

/** Only known editable fields leave the server; structural/protected errors stay general. */
function parseStaff<S extends z.ZodType>(
  schema: S,
  body: unknown,
  family: 'guidance' | 'reason' | 'description'
): z.output<S> {
  const result = schema.safeParse(body);
  if (result.success) return result.data as z.output<S>;
  const fields: string[] = [];
  for (const issue of result.error.issues) {
    const path = issue.path;
    if (!['invalid_type', 'too_small', 'too_big'].includes(issue.code))
      throw new BadRequestException('Invalid solar document request');
    if (family !== 'guidance' && path.length === 1 && path[0] === family) {
      fields.push(family);
    } else if (
      family === 'guidance' &&
      path.length === 1 &&
      (path[0] === 'fa' || path[0] === 'en')
    ) {
      fields.push(path[0]);
    } else if (family === 'guidance' && path[0] === 'suggestions') {
      if (path.length === 1 && issue.code === 'too_big')
        fields.push('suggestionsFa', 'suggestionsEn');
      else if (
        path.length === 3 &&
        typeof path[1] === 'number' &&
        (path[2] === 'fa' || path[2] === 'en')
      )
        fields.push(path[2] === 'fa' ? 'suggestionsFa' : 'suggestionsEn');
      else throw new BadRequestException('Invalid solar document request');
    } else throw new BadRequestException('Invalid solar document request');
  }
  throw new InputFieldException(fields);
}

function requireFormPermission(req: AuthenticatedRequest, permission: string) {
  if (!hasStaffPermission(req, permission)) throw new ForbiddenException();
}

@ApiTags('Solar documents')
@ApiBearerAuth()
@Controller('api/solar')
@UseGuards(SessionAuthGuard)
export class SolarDocumentsController {
  constructor(private readonly service: SolarDocumentsService) {}

  @Get('document-guidance')
  @ApiOperation({ summary: 'Read solar document guidance and suggested file list' })
  guidance() {
    return this.service.guidance();
  }

  @Get('requests/:id/documents')
  @ApiOperation({ summary: 'Read customer solar document guidance and staff requests' })
  state(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    return this.service.customerState(req.session, id);
  }

  @Post('requests/:id/documents/complete')
  @HttpCode(200)
  @RateLimit({ namespace: 'solar:documents:complete', limit: 10, windowMs: 60_000 })
  @ApiOperation({ summary: 'Submit the document set for review, including an empty set' })
  @ApiZodBody(complete)
  complete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    parse(complete, body);
    return this.service.complete(req.session, id, req.ip ?? '127.0.0.1');
  }
}

@ApiTags('Admin · Solar documents')
@ApiBearerAuth()
@Controller('api/admin/solar')
@UseGuards(SessionAuthGuard)
export class StaffSolarDocumentsController {
  constructor(private readonly service: SolarDocumentsService) {}

  @Get('document-guidance')
  @ApiOperation({ summary: 'Read editable solar document guidance' })
  guidance() {
    return this.service.guidance();
  }

  @Put('document-guidance')
  @ApiOperation({ summary: 'Edit solar document guidance and suggestions' })
  @ApiZodBody(guidance)
  setGuidance(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    requireFormPermission(req, 'admin:catalogue:edit');
    return this.service.setGuidance(
      req.session,
      parseStaff(guidance, body, 'guidance'),
      req.ip ?? '127.0.0.1'
    );
  }

  @Get('requests')
  @ApiOperation({ summary: 'List solar requests awaiting document work' })
  @ApiQuery({ name: 'before', required: false, format: 'uuid' })
  queue(@Req() req: AuthenticatedRequest, @Query('before') before?: string) {
    if (before && !z.string().uuid().safeParse(before).success)
      throw new BadRequestException('Invalid solar request cursor');
    return this.service.staffQueue(req.session, before);
  }

  @Get('document-review-queue')
  @ApiOperation({ summary: 'List individual solar documents awaiting staff review' })
  @ApiQuery({ name: 'before', required: false, format: 'uuid' })
  documentQueue(@Req() req: AuthenticatedRequest, @Query('before') before?: string) {
    if (before && !z.string().uuid().safeParse(before).success)
      throw new BadRequestException('Invalid solar document cursor');
    return this.service.staffDocumentQueue(req.session, before);
  }

  @Get('requests/:id/documents')
  @ApiOperation({ summary: 'Read individual solar documents and their review statuses' })
  documents(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    return this.service.staffDocuments(req.session, id);
  }

  @Post('requests/:id/documents/:docId/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve one solar document' })
  @ApiZodBody(review)
  approve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    const input = parse(review, body);
    return this.service.decide(
      req.session,
      id,
      docId,
      'approve',
      input.expectedRevision,
      input.reason,
      req.ip ?? '127.0.0.1'
    );
  }

  @Post('requests/:id/documents/:docId/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject one solar document with a reason' })
  @ApiZodBody(rejection)
  reject(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    requireFormPermission(req, 'orders:write');
    const input = parseStaff(rejection, body, 'reason');
    return this.service.decide(
      req.session,
      id,
      docId,
      'reject',
      input.expectedRevision,
      input.reason,
      req.ip ?? '127.0.0.1'
    );
  }

  @Post('requests/:id/documents/request-additional')
  @HttpCode(200)
  @ApiOperation({ summary: 'Request an additional or replacement solar document' })
  @ApiZodBody(confirmedAdditional)
  requestAdditional(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    requireFormPermission(req, 'orders:write');
    const input = parseStaff(confirmedAdditional, body, 'description');
    return this.service.requestAdditional(
      req.session,
      id,
      input.description,
      input.expectedReviewHash,
      req.ip ?? '127.0.0.1'
    );
  }

  @Post('requests/:id/documents/review-set-decision')
  @HttpCode(200)
  @ApiOperation({ summary: 'Review current solar document set before a staff stage decision' })
  @ApiZodBody(setDecisionReview)
  reviewSetDecision(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    requireFormPermission(req, 'orders:write');
    const input = parseStaff(setDecisionReview, body, 'description');
    return this.service.reviewSetDecision(req.session, id, input.decision, input.description);
  }

  @Post('requests/:id/documents/advance')
  @HttpCode(200)
  @ApiOperation({ summary: 'Advance a sufficient solar document set to postal submission' })
  @ApiZodBody(confirmedAdvance)
  advance(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    return this.service.advanceToPostal(
      req.session,
      id,
      parse(confirmedAdvance, body).expectedReviewHash,
      req.ip ?? '127.0.0.1'
    );
  }
}

@ApiTags('Staff · Solar documents')
@ApiBearerAuth()
@Controller('api/staff/solar')
@UseGuards(SessionAuthGuard)
export class SolarStaffDocumentsController extends StaffSolarDocumentsController {
  constructor(service: SolarDocumentsService) {
    super(service);
  }
}
