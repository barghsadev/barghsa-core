import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { SolarDocumentsService } from './solar-documents.service.js';

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
const additional = z.object({ description: z.string().trim().min(1).max(2000) }).strict();
function parse<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestException('Invalid solar document request');
  return result.data as z.output<S>;
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
    return this.service.setGuidance(req.session, parse(guidance, body), req.ip ?? '127.0.0.1');
  }

  @Get('requests')
  @ApiOperation({ summary: 'List solar requests awaiting document work' })
  queue(@Req() req: AuthenticatedRequest) {
    return this.service.staffQueue(req.session);
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
  @ApiZodBody(review)
  reject(
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
      'reject',
      input.expectedRevision,
      input.reason,
      req.ip ?? '127.0.0.1'
    );
  }

  @Post('requests/:id/documents/request-additional')
  @HttpCode(200)
  @ApiOperation({ summary: 'Request an additional or replacement solar document' })
  @ApiZodBody(additional)
  requestAdditional(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    return this.service.requestAdditional(
      req.session,
      id,
      parse(additional, body).description,
      req.ip ?? '127.0.0.1'
    );
  }

  @Post('requests/:id/documents/advance')
  @HttpCode(200)
  @ApiOperation({ summary: 'Advance a sufficient solar document set to postal submission' })
  advance(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    return this.service.advanceToPostal(req.session, id, req.ip ?? '127.0.0.1');
  }
}
