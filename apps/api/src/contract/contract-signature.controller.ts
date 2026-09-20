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
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ErrorCodes } from '@barghsa/shared/errors';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { RequiresStepUp, StepUpGuard } from '../session/step-up.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { ContractSignatureService } from './contract-signature.service.js';
import { contractUuid } from './contract-validation.js';
import { signatureRequestSchema, signatureRecordSchema } from './contract-signature-validation.js';
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new HttpException({ error: ErrorCodes.VALIDATION_PARSE_ZOD.code }, 400);
  return result.data;
}
const common = {
  expectedVersionId: { type: 'string' as const, format: 'uuid' },
  idempotencyKey: { type: 'string' as const, format: 'uuid' },
};
const recordBody = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['expectedVersionId', 'idempotencyKey', 'requestId', 'signedDocumentId'],
  properties: {
    ...common,
    requestId: { type: 'string' as const, format: 'uuid' },
    signedDocumentId: { type: 'string' as const, format: 'uuid' },
  },
};
@ApiTags('Admin · Contracts')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, StepUpGuard)
@Controller('api/admin/contracts')
export class ContractSignatureController {
  constructor(private readonly service: ContractSignatureService) {}
  private authorize(req: AuthenticatedRequest, write = false) {
    if (!hasStaffPermission(req, write ? 'contracts:write' : 'contracts:read'))
      throw new HttpException({ error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
  }
  @Get(':id/signature')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiQuery({ name: 'versionId', required: false, type: String })
  @ApiOperation({
    summary: 'Read exact-version signing request and signed-copy evidence for staff',
  })
  get(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('versionId') versionId?: string
  ) {
    this.authorize(req);
    return this.service.get(
      parse(contractUuid, id),
      versionId === undefined ? undefined : parse(contractUuid, versionId),
      req.session,
      true,
      hasStaffPermission(req, 'contracts:write')
    );
  }
  @Post(':id/signature-request')
  @HttpCode(200)
  @RequiresStepUp()
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary:
      'Prepare a numbered signing request from the accepted version and approved original PDF',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['expectedVersionId', 'idempotencyKey', 'originalDocumentId', 'expectedRequestId'],
      properties: {
        ...common,
        originalDocumentId: { type: 'string', format: 'uuid' },
        expectedRequestId: {
          type: 'string',
          format: 'uuid',
          nullable: true,
          description: 'Null for the first request; otherwise the current latest request ID.',
        },
      },
    },
  })
  request(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    this.authorize(req, true);
    return this.service.request(
      parse(contractUuid, id),
      parse(signatureRequestSchema, body),
      req.session,
      req.ip ?? '127.0.0.1'
    );
  }
  @Post(':id/signature')
  @HttpCode(200)
  @RequiresStepUp()
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary:
      'Record an approved signed copy as staff without attributing the customer signature to staff',
  })
  @ApiBody({ schema: recordBody })
  record(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    this.authorize(req, true);
    return this.service.record(
      parse(contractUuid, id),
      parse(signatureRecordSchema, body),
      req.session,
      req.ip ?? '127.0.0.1',
      true
    );
  }
}
@ApiTags('Contracts')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, StepUpGuard)
@Controller('api/contracts')
export class CustomerContractSignatureController {
  constructor(private readonly service: ContractSignatureService) {}
  @Get(':id/signature')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiQuery({ name: 'versionId', required: false, type: String })
  @ApiOperation({
    summary: 'Read signing evidence for an authorized published version without staff identifiers',
  })
  get(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('versionId') versionId?: string
  ) {
    return this.service.get(
      parse(contractUuid, id),
      versionId === undefined ? undefined : parse(contractUuid, versionId),
      req.session,
      false
    );
  }
  @Post(':id/signature')
  @HttpCode(200)
  @RequiresStepUp()
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Record an approved signed copy for the exact accepted contract version',
  })
  @ApiBody({ schema: recordBody })
  record(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.service.record(
      parse(contractUuid, id),
      parse(signatureRecordSchema, body),
      req.session,
      req.ip ?? '127.0.0.1',
      false
    );
  }
}
