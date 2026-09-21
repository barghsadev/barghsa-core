import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Put,
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
import { contractUuid } from './contract-validation.js';
import { activationRuleInput, activationServiceType } from './contract-activation-validation.js';
import { ContractActivationService } from './contract-activation.service.js';
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new HttpException({ error: ErrorCodes.VALIDATION_PARSE_ZOD.code }, 400);
  return result.data;
}
function requirePermission(req: AuthenticatedRequest, permission: string) {
  if (!hasStaffPermission(req, permission))
    throw new HttpException({ error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
}
@ApiTags('Admin · Contracts')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, StepUpGuard)
@Controller('api/admin/contract-activation-rules')
export class ContractActivationRulesController {
  constructor(private readonly service: ContractActivationService) {}
  @Get()
  @ApiOperation({
    summary: 'Read per-service activation rules; changes apply to new contract versions',
  })
  get(@Req() req: AuthenticatedRequest) {
    const canEdit = hasStaffPermission(req, 'admin:catalogue:edit');
    if (!canEdit) requirePermission(req, 'contracts:read');
    return this.service.rules(req.session, canEdit);
  }
  @Put(':serviceType')
  @RequiresStepUp()
  @ApiParam({ name: 'serviceType', enum: ['electricity', 'savings', 'solar'] })
  @ApiOperation({ summary: 'Update versioned activation rules for future contract versions' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'expectedRevision',
        'signatureRequired',
        'paymentRequired',
        'serviceStartRequired',
        'idempotencyKey',
      ],
      properties: {
        expectedRevision: { type: 'integer', minimum: 1, maximum: 2147483646 },
        signatureRequired: { type: 'boolean' },
        paymentRequired: { type: 'boolean' },
        serviceStartRequired: { type: 'boolean' },
        idempotencyKey: { type: 'string', format: 'uuid' },
      },
    },
  })
  update(
    @Req() req: AuthenticatedRequest,
    @Param('serviceType') type: string,
    @Body() body: unknown
  ) {
    requirePermission(req, 'admin:catalogue:edit');
    return this.service.updateRule(
      parse(activationServiceType, type),
      parse(activationRuleInput, body),
      req.session,
      req.ip ?? '127.0.0.1'
    );
  }
}
@ApiTags('Admin · Contracts')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/admin/contracts')
export class StaffContractActivationController {
  constructor(private readonly service: ContractActivationService) {}
  @Get(':id/activation')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiQuery({ name: 'versionId', required: false, type: String })
  @ApiOperation({
    summary: 'Read exact-version activation prerequisites without changing contract state',
  })
  get(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('versionId') version?: string
  ) {
    requirePermission(req, 'contracts:read');
    return this.service.get(
      parse(contractUuid, id),
      version === undefined ? undefined : parse(contractUuid, version),
      req.session,
      true
    );
  }
}
@ApiTags('Contracts')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/contracts')
export class CustomerContractActivationController {
  constructor(private readonly service: ContractActivationService) {}
  @Get(':id/activation')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiQuery({ name: 'versionId', required: false, type: String })
  @ApiOperation({
    summary: 'Read activation prerequisites for an authorized published contract version',
  })
  get(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('versionId') version?: string
  ) {
    return this.service.get(
      parse(contractUuid, id),
      version === undefined ? undefined : parse(contractUuid, version),
      req.session,
      false
    );
  }
}
