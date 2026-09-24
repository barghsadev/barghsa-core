import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { RequiresStepUp, StepUpGuard } from '../session/step-up.guard.js';
import { DocumentRetentionService, type RetentionKind } from './document-retention.service.js';

const kindSchema = z.enum([
  'contract',
  'invoice',
  'payment',
  'refund',
  'signed_document',
  'order',
  'solar_request',
  'standalone',
]);
const policySchema = z
  .object({
    retentionYears: z.number().int().min(1).max(100),
    legalHold: z.boolean(),
    approvalNote: z.string().trim().min(3).max(1000),
  })
  .strict();
const holdSchema = z
  .object({
    documentId: z.string().uuid().optional(),
    profileId: z.string().uuid().optional(),
    reason: z.string().trim().min(3).max(1000),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict()
  .refine((value) => Boolean(value.documentId) !== Boolean(value.profileId));
const releaseSchema = z.object({ note: z.string().trim().min(3).max(1000) }).strict();

function parse<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const result = schema.safeParse(raw);
  if (!result.success) throw new BadRequestException('Invalid document retention request');
  return result.data;
}

@Controller('api/admin/document-retention')
@UseGuards(SessionAuthGuard)
export class DocumentRetentionController {
  constructor(
    @Inject(DocumentRetentionService) private readonly retention: DocumentRetentionService
  ) {}

  private authorize(request: AuthenticatedRequest, write = false) {
    if (!hasStaffPermission(request, 'admin:documents:edit'))
      throw new ForbiddenException('Document retention access denied');
    if (write && !hasStaffPermission(request, 'legal:write'))
      throw new ForbiddenException('Legal approval authority is required');
  }

  @Get('policies')
  async policies(@Req() request: AuthenticatedRequest) {
    this.authorize(request);
    return {
      canManage: hasStaffPermission(request, 'legal:write'),
      policies: await this.retention.listPolicies(),
    };
  }

  @Put('policies/:kind')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  replacePolicy(
    @Req() request: AuthenticatedRequest,
    @Param('kind') kind: string,
    @Body() body: unknown
  ) {
    this.authorize(request, true);
    return this.retention.replacePolicy(
      parse(kindSchema, kind) as RetentionKind,
      parse(policySchema, body),
      request.session,
      request.ip ?? ''
    );
  }

  @Get('holds')
  async holds(
    @Req() request: AuthenticatedRequest,
    @Query('documentId', new ParseUUIDPipe()) documentId: string
  ) {
    this.authorize(request);
    return {
      ...(await this.retention.listHolds(documentId)),
      canManage: hasStaffPermission(request, 'legal:write'),
    };
  }

  @Post('holds')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  createHold(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    this.authorize(request, true);
    return this.retention.createHold(parse(holdSchema, body), request.session, request.ip ?? '');
  }

  @Post('holds/:id/release')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  releaseHold(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown
  ) {
    this.authorize(request, true);
    return this.retention.releaseHold(
      id,
      parse(releaseSchema, body).note,
      request.session,
      request.ip ?? ''
    );
  }

  @Get('destruction')
  async destruction(@Req() request: AuthenticatedRequest) {
    this.authorize(request);
    return {
      ...(await this.retention.listDestruction()),
      canManage: hasStaffPermission(request, 'legal:write'),
    };
  }

  @Post('destruction/:id/approve')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  approveDestruction(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown
  ) {
    this.authorize(request, true);
    return this.retention.approveDestruction(
      id,
      parse(releaseSchema, body).note,
      request.session,
      request.ip ?? ''
    );
  }
}
