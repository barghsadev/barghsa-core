import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import { ErrorCodes } from '@barghsa/shared/errors';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { RequiresStepUp, StepUpGuard } from '../session/step-up.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { authoringQuery, contractAuthoringOptions } from './contract-authoring.js';
import { ContractService } from './contract.service.js';
import {
  contractUuid,
  createContractSchema,
  updateContractSchema,
  contractListSchema,
} from './contract-validation.js';
const editProperties = {
  activationContext: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['initialInvoiceId', 'serviceStartsAt'],
    properties: {
      initialInvoiceId: { type: 'string' as const, format: 'uuid', nullable: true },
      serviceStartsAt: { type: 'string' as const, format: 'date-time', nullable: true },
      serviceEndsAt: {
        type: 'string' as const,
        format: 'date-time',
        nullable: true,
        description: 'Optional end of service term; omitted edits preserve the existing end.',
      },
    },
  },
  content: {
    type: 'object' as const,
    additionalProperties: true,
    description:
      'Full material snapshot, nonempty and at most 64 KiB. Optional commercialValue is {kind:"fixed",amountIrr:"..."} (whole IRR within signed 64-bit range) or {kind:"variable",description:"..."}. Do not use an initial invoice amount as the full contract value.',
  },
  changeDescription: { type: 'string' as const, minLength: 1, maxLength: 1000 },
  idempotencyKey: { type: 'string' as const, format: 'uuid' },
};
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new HttpException({ error: ErrorCodes.VALIDATION_PARSE_ZOD.code }, 400);
  return result.data;
}
@ApiTags('Admin · Contracts')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, StepUpGuard)
@Controller('api/admin/contracts')
export class ContractController {
  constructor(private readonly service: ContractService) {}
  private authorize(req: AuthenticatedRequest, write = false) {
    if (!hasStaffPermission(req, write ? 'contracts:write' : 'contracts:read'))
      throw new HttpException({ error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
  }
  @Get()
  @ApiOperation({ summary: 'List staff contract metadata with bounded filters and pagination' })
  @ApiQuery({ name: 'profileId', required: false, type: String })
  @ApiQuery({ name: 'serviceType', required: false, enum: ['electricity', 'savings', 'solar'] })
  @ApiQuery({ name: 'state', required: false, type: String })
  @ApiQuery({ name: 'before', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  list(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    this.authorize(req);
    return this.service.list(parse(contractListSchema, query));
  }
  @Get('authoring-options')
  @ApiOperation({
    summary: 'Search active profile names or page eligible order references for drafting',
  })
  @ApiQuery({ name: 'search', required: false, type: String, maxLength: 100 })
  @ApiQuery({ name: 'profileId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'before', required: false, type: String, format: 'uuid' })
  authoringOptions(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    this.authorize(req, true);
    return contractAuthoringOptions(parse(authoringQuery, query));
  }
  @Post()
  @RequiresStepUp()
  @ApiOperation({ summary: 'Create a staff draft contract with its initial immutable version' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['profileId', 'serviceType', 'content', 'changeDescription', 'idempotencyKey'],
      properties: {
        ...editProperties,
        profileId: { type: 'string', format: 'uuid' },
        orderId: { type: 'string', format: 'uuid' },
        serviceType: { type: 'string', enum: ['electricity', 'savings', 'solar'] },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description:
      'Draft contract and full current version. Matching retries return the original result.',
  })
  create(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    this.authorize(req, true);
    return this.service.create(
      parse(createContractSchema, body),
      req.session,
      req.ip ?? '127.0.0.1'
    );
  }
  @Patch(':id')
  @RequiresStepUp()
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Replace draft content or revise and resubmit requested changes as a new version',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['expectedVersionId', 'content', 'changeDescription', 'idempotencyKey'],
      properties: { ...editProperties, expectedVersionId: { type: 'string', format: 'uuid' } },
    },
  })
  @ApiResponse({
    status: 200,
    description:
      'Updated draft, or revised contract resubmitted for staff review. Unchanged content and activation context create no version; resubmission requires a material change.',
  })
  @ApiResponse({
    status: 409,
    description: 'Stale version, non-draft state, archived profile or conflicting idempotency key.',
  })
  update(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    this.authorize(req, true);
    return this.service.updateContract(
      parse(contractUuid, id),
      parse(updateContractSchema, body),
      req.session,
      req.ip ?? '127.0.0.1'
    );
  }
  @Get(':id/cancellation-preview')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Read the current version and refund balances before a cancellation decision',
  })
  @ApiResponse({
    status: 200,
    description:
      'Authoritative financial snapshot and fingerprint. This read does not cancel the contract, create a refund or imply financial closure.',
  })
  cancellationPreview(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    this.authorize(req, true);
    return this.service.cancellationPreview(parse(contractUuid, id));
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Read a staff contract with its current full version' })
  get(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    this.authorize(req);
    return this.service.get(parse(contractUuid, id));
  }
  @Get(':id/versions')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiQuery({
    name: 'before',
    required: false,
    type: Number,
    description: 'Exclusive version-number cursor; at most 100 metadata records.',
  })
  @ApiOperation({ summary: 'Read immutable contract version metadata newest first' })
  versions(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('before') before?: string
  ) {
    this.authorize(req);
    return this.service.versions(
      parse(contractUuid, id),
      before === undefined
        ? undefined
        : parse(z.coerce.number().int().min(1).max(2147483647), before)
    );
  }
  @Get(':id/versions/:versionId')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'versionId', format: 'uuid' })
  @ApiOperation({ summary: 'Read a specific immutable contract snapshot' })
  version(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('versionId') versionId: string
  ) {
    this.authorize(req);
    return this.service.version(parse(contractUuid, id), parse(contractUuid, versionId));
  }
}
