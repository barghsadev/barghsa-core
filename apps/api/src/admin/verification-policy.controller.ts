import type { SchemaObject } from '@nestjs/swagger';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  isVerificationPolicy,
  VERIFICATION_DOCUMENT_TYPES,
  type VerificationPolicy,
} from '@barghsa/shared/verification';
import { z } from 'zod';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { InputFieldException } from '../common/input-field.exception.js';
import { activationHistoryQuery } from './config-activation-history.js';
import {
  changeVerificationPolicy,
  readVerificationPolicyConfig,
  readVerificationPolicyHistory,
} from './verification-policy-config.js';

const requirementSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['required', 'documents', 'expiryDays'],
  properties: {
    required: { type: 'boolean' },
    documents: {
      type: 'array',
      maxItems: 5,
      uniqueItems: true,
      items: { type: 'string', enum: [...VERIFICATION_DOCUMENT_TYPES] },
    },
    expiryDays: { type: 'integer', minimum: 1, maximum: 3650, nullable: true },
  },
};
const policySchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['INDIVIDUAL', 'LEGAL', 'autoVerifyStaff', 'allowManualOverride'],
  properties: {
    INDIVIDUAL: requirementSchema,
    LEGAL: requirementSchema,
    autoVerifyStaff: { type: 'boolean' },
    allowManualOverride: { type: 'boolean' },
  },
};
const viewSchema: SchemaObject = {
  type: 'object',
  required: ['active', 'draft', 'version'],
  properties: {
    active: policySchema,
    draft: { ...policySchema, nullable: true },
    version: { type: 'integer', minimum: 0 },
  },
};
const policyChange = z
  .object({
    action: z.enum(['draft', 'activate']),
    expectedVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    policy: z.custom<VerificationPolicy>(isVerificationPolicy),
  })
  .strict();
const restoreChange = z.strictObject({
  action: z.literal('restore'),
  expectedVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  sourceId: z.uuid(),
});
const changeSchema = z.discriminatedUnion('action', [policyChange, restoreChange]);
@ApiTags('Admin verification policy')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/admin/config/profile-verification-policy')
export class VerificationPolicyController {
  @Get()
  @ApiResponse({ status: 200, schema: viewSchema })
  @ApiOperation({ summary: 'Read active verification requirements and saved draft' })
  read(@Req() req: AuthenticatedRequest) {
    if (!hasStaffPermission(req, 'admin:config:read')) throw new ForbiddenException();
    return readVerificationPolicyConfig();
  }
  @Get('history')
  @Header('Cache-Control', 'private, no-cache, no-store, must-revalidate')
  @ApiOperation({ summary: 'Read audited verification policy activations' })
  @ApiQuery({
    name: 'beforeVersion',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 2147483647 },
  })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      required: ['items', 'nextBeforeVersion'],
      properties: {
        items: {
          type: 'array',
          maxItems: 20,
          items: {
            type: 'object',
            required: ['id', 'version', 'policy'],
            properties: {
              id: { type: 'string', format: 'uuid' },
              version: { type: 'integer', minimum: 1 },
              policy: policySchema,
            },
          },
        },
        nextBeforeVersion: { type: 'integer', nullable: true, minimum: 1 },
      },
    },
  })
  history(@Query() query: unknown, @Req() req: AuthenticatedRequest) {
    if (!hasStaffPermission(req, 'admin:config:read')) throw new ForbiddenException();
    const parsed = activationHistoryQuery.safeParse(query);
    if (!parsed.success) throw new InputFieldException(['beforeVersion']);
    return readVerificationPolicyHistory(req.session, parsed.data.beforeVersion);
  }
  @Put()
  @ApiResponse({ status: 200, schema: viewSchema })
  @HttpCode(200)
  @ApiOperation({ summary: 'Save or activate exact versioned verification requirements' })
  @ApiBody({
    schema: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['action', 'expectedVersion', 'policy'],
          properties: {
            action: { type: 'string', enum: ['draft', 'activate'] },
            expectedVersion: { type: 'integer', minimum: 0 },
            policy: policySchema,
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['action', 'expectedVersion', 'sourceId'],
          properties: {
            action: { type: 'string', enum: ['restore'] },
            expectedVersion: { type: 'integer', minimum: 0 },
            sourceId: { type: 'string', format: 'uuid' },
          },
        },
      ],
    },
  })
  write(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    if (!hasStaffPermission(req, 'admin:config:write')) throw new ForbiddenException();
    const parsed = changeSchema.safeParse(body);
    if (!parsed.success) throw new InputFieldException(['policy']);
    return changeVerificationPolicy(parsed.data, req.session, req.ip ?? 'unknown');
  }
}
