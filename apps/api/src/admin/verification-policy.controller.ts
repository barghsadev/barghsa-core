import type { SchemaObject } from '@nestjs/swagger';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  isVerificationPolicy,
  VERIFICATION_DOCUMENT_TYPES,
  type VerificationPolicy,
} from '@barghsa/shared/verification';
import { z } from 'zod';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { InputFieldException } from '../common/input-field.exception.js';
import {
  changeVerificationPolicy,
  readVerificationPolicyConfig,
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
const schema = z
  .object({
    action: z.enum(['draft', 'activate']),
    expectedVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    policy: z.custom<VerificationPolicy>(isVerificationPolicy),
  })
  .strict();
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
  @Put()
  @ApiResponse({ status: 200, schema: viewSchema })
  @HttpCode(200)
  @ApiOperation({ summary: 'Save or activate exact versioned verification requirements' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['action', 'expectedVersion', 'policy'],
      properties: {
        action: { type: 'string', enum: ['draft', 'activate'] },
        expectedVersion: { type: 'integer', minimum: 0 },
        policy: policySchema,
      },
    },
  })
  write(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    if (!hasStaffPermission(req, 'admin:config:write')) throw new ForbiddenException();
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new InputFieldException(['policy']);
    return changeVerificationPolicy(parsed.data, req.session, req.ip ?? 'unknown');
  }
}
