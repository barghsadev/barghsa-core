import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
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
import { ContractReviewService } from './contract-review.service.js';
import {
  contractUuid,
  contractReviewSchema,
  contractChangesSchema,
  contractAcceptanceSchema,
} from './contract-validation.js';
const reviewBody = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['expectedVersionId', 'idempotencyKey'],
  properties: {
    expectedVersionId: { type: 'string' as const, format: 'uuid' },
    idempotencyKey: { type: 'string' as const, format: 'uuid' },
  },
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
export class ContractReviewController {
  constructor(private readonly service: ContractReviewService) {}
  @Post(':id/:action')
  @HttpCode(200)
  @RequiresStepUp()
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'action', enum: ['submit', 'request-changes', 'publish'] })
  @ApiOperation({
    summary: 'Submit, request changes or publish the exact current contract version',
  })
  @ApiBody({
    schema: {
      ...reviewBody,
      properties: {
        ...reviewBody.properties,
        reason: {
          type: 'string',
          minLength: 1,
          maxLength: 1000,
          description: 'Required only for request-changes.',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Updated staff contract. Matching retries return the original result.',
  })
  @ApiResponse({ status: 409, description: 'Stale version or invalid state transition.' })
  act(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('action') raw: string,
    @Body() body: unknown
  ) {
    if (!hasStaffPermission(req, 'contracts:write'))
      throw new HttpException({ error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
    const action = parse(z.enum(['submit', 'request-changes', 'publish']), raw);
    const input =
      action === 'request-changes'
        ? parse(contractChangesSchema, body)
        : parse(contractReviewSchema, body);
    return this.service.act(
      parse(contractUuid, id),
      action,
      input,
      req.session,
      req.ip ?? '127.0.0.1'
    );
  }
}
@ApiTags('Contracts')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, StepUpGuard)
@Controller('api/contracts')
export class CustomerContractController {
  constructor(private readonly service: ContractReviewService) {}
  @Get()
  @ApiOperation({ summary: 'List published contracts on the current authorized profile' })
  @ApiQuery({
    name: 'before',
    required: false,
    type: String,
    description: 'Exclusive contract UUID cursor; at most 100 records.',
  })
  list(@Req() req: AuthenticatedRequest, @Query('before') before?: string) {
    return this.service.list(
      req.session,
      before === undefined ? undefined : parse(contractUuid, before)
    );
  }
  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Read the latest published contract snapshot, excluding internal drafts',
  })
  get(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.service.get(parse(contractUuid, id), req.session);
  }
  @Get(':id/versions')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiQuery({
    name: 'before',
    required: false,
    type: Number,
    description: 'Exclusive version-number cursor; at most 100 published metadata records.',
  })
  @ApiOperation({ summary: 'List only published version metadata for the authorized profile' })
  versions(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('before') before?: string
  ) {
    return this.service.versions(
      parse(contractUuid, id),
      req.session,
      before === undefined
        ? undefined
        : parse(z.coerce.number().int().min(1).max(2147483647), before)
    );
  }
  @Get(':id/versions/:versionId')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'versionId', format: 'uuid' })
  @ApiOperation({ summary: 'Read an individual published snapshot for the authorized profile' })
  version(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('versionId') versionId: string
  ) {
    return this.service.get(parse(contractUuid, id), req.session, parse(contractUuid, versionId));
  }
  @Get(':id/acceptance-review')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiQuery({ name: 'versionId', required: true, type: String })
  @ApiOperation({
    summary: 'Review the published terms and financial conditions before acceptance',
  })
  acceptanceReview(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('versionId') versionId: string
  ) {
    return this.service.acceptanceReview(
      parse(contractUuid, id),
      parse(contractUuid, versionId),
      req.session
    );
  }
  @Post(':id/accept')
  @HttpCode(200)
  @RequiresStepUp()
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Accept the exact current published version as the authorized customer',
  })
  @ApiBody({
    schema: {
      ...reviewBody,
      required: [...reviewBody.required, 'expectedReviewHash'],
      properties: {
        ...reviewBody.properties,
        expectedReviewHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description:
      'Published snapshot with immutable customer acceptance evidence. Does not activate or sign the contract.',
  })
  @ApiResponse({
    status: 409,
    description: 'Stale version, conflicting retry or contract no longer awaiting acceptance.',
  })
  accept(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.service.accept(
      parse(contractUuid, id),
      parse(contractAcceptanceSchema, body),
      req.session,
      req.ip ?? '127.0.0.1'
    );
  }
}
