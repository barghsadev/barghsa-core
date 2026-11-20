import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { assertEmptyCommandBody } from '../common/empty-command-body.js';
import { z } from 'zod';
import { withStaffReadAuthority } from '../admin/staff-read-authority.js';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import { InputFieldException } from '../common/input-field.exception.js';
import { ErrorCodes } from '@barghsa/shared/errors';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { RequiresStepUp, StepUpGuard } from '../session/step-up.guard.js';
import { SavingCatalogueService } from './saving-catalogue.service.js';

const idSchema = z.string().uuid();
const duplicatePolicySchema = z.object({ preventActiveDuplicates: z.boolean() }).strict();
export const draftSavingAgreementSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    body: z.string().trim().min(1).max(50_000),
  })
  .strict();
function parse<T>(schema: z.ZodType<T>, value: unknown, fields: string[] = []): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    if (
      result.error.issues.length &&
      result.error.issues.every(
        (issue) =>
          issue.code !== 'unrecognized_keys' &&
          issue.path.length === 1 &&
          fields.includes(String(issue.path[0]))
      )
    )
      throw new InputFieldException(result.error.issues.map((issue) => String(issue.path[0])));
    throw new HttpException({ error: ErrorCodes.VALIDATION_PARSE_ZOD.code }, 400);
  }
  return result.data;
}

@ApiTags('Saving plans')
@ApiBearerAuth()
@Controller('api/saving/plans')
@UseGuards(SessionAuthGuard)
export class CustomerSavingCatalogueController {
  constructor(private readonly service: SavingCatalogueService) {}

  @Get()
  @ApiOperation({ summary: 'Browse saving plans, compatible hardware, and active agreements' })
  browse() {
    return this.service.browse();
  }
}

@ApiTags('Admin · Saving plans')
@ApiBearerAuth()
@Controller('api/admin/catalogue/saving-plans')
@UseGuards(SessionAuthGuard, StepUpGuard)
export class AdminSavingCatalogueController {
  constructor(private readonly service: SavingCatalogueService) {}

  private authorize(req: AuthenticatedRequest) {
    if (!hasStaffPermission(req, 'admin:catalogue:edit'))
      throw new HttpException({ error: 'AUTHZ:FORBIDDEN' }, 403);
  }

  @Get(':id/configuration')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Read assigned hardware and saving-plan agreement versions' })
  configuration(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.authorize(req);
    const planId = parse(idSchema, id);
    return withStaffReadAuthority(req.session, 'admin:catalogue:edit', (client) =>
      this.service.admin(planId, client)
    );
  }

  @Put(':id/duplicate-policy')
  @RequiresStepUp()
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Set active saving-order duplicate policy for a plan' })
  @ApiZodBody(duplicatePolicySchema)
  duplicatePolicy(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    this.authorize(req);
    return this.service.setDuplicatePolicy(
      parse(idSchema, id),
      parse(duplicatePolicySchema, body).preventActiveDuplicates,
      req.session,
      req.ip ?? '127.0.0.1'
    );
  }

  @Post(':id/agreements/draft')
  @RequiresStepUp()
  @RateLimit({ namespace: 'saving:agreement-draft:user', limit: 10, windowMs: 60_000 })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Save a new draft of a saving-plan agreement' })
  @ApiZodBody(draftSavingAgreementSchema)
  draft(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    this.authorize(req);
    return this.service.saveDraft(
      parse(idSchema, id),
      parse(draftSavingAgreementSchema, body, ['title', 'body']),
      req.session,
      req.ip ?? '127.0.0.1'
    );
  }

  @Post(':id/agreements/:versionId/activate')
  @RequiresStepUp()
  @RateLimit({ namespace: 'saving:agreement-activate:user', limit: 10, windowMs: 60_000 })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'versionId', format: 'uuid' })
  @ApiOperation({ summary: 'Activate an agreement draft and supersede the old version' })
  @ApiResponse({ status: 201, description: 'Agreement version activated.' })
  @ApiBody({ required: false, schema: { type: 'object', additionalProperties: false } })
  @ApiResponse({
    status: 400,
    description: 'Invalid agreement or product ID, or unexpected request body',
  })
  activate(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body?: unknown
  ) {
    this.authorize(req);
    assertEmptyCommandBody(body);
    return this.service.activate(
      parse(idSchema, id),
      parse(idSchema, versionId),
      req.session,
      req.ip ?? '127.0.0.1'
    );
  }
}
