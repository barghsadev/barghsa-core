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
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import { z } from 'zod';
import {
  isServiceWorkflowPolicy,
  SERVICE_WORKFLOW_KEYS,
  type ServiceWorkflowPolicy,
} from '@barghsa/shared/admin';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { InputFieldException } from '../common/input-field.exception.js';
import { readServiceWorkflows, saveServiceWorkflows } from './service-workflow-config.js';

const audience = (source: boolean): SchemaObject => ({
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'id'],
      properties: {
        kind: { type: 'string', enum: [source ? 'any' : 'admins'] },
        id: { type: 'string', nullable: true, enum: [null] },
      },
    },
    ...(['role', 'team'] as const).map((kind) => ({
      type: 'object' as const,
      additionalProperties: false,
      required: ['kind', 'id'],
      properties: {
        kind: { type: 'string' as const, enum: [kind] },
        id: {
          type: 'string' as const,
          minLength: 1,
          maxLength: 100,
          pattern:
            kind === 'team'
              ? '^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$'
              : '^[a-zA-Z0-9_-]{1,100}$',
        },
      },
    })),
  ],
});
const target: SchemaObject = {
  type: 'object',
  nullable: true,
  additionalProperties: false,
  required: ['hours', 'notification', 'email', 'escalation'],
  properties: {
    hours: { type: 'integer', minimum: 1, maximum: 8760 },
    notification: {
      type: 'string',
      enum: ['breach', 'escalation'],
      description:
        'Escalation-only delivery requires a non-null rule. Inbox is always included when delivery fires.',
    },
    email: { type: 'boolean' },
    escalation: {
      type: 'object',
      nullable: true,
      additionalProperties: false,
      required: ['condition', 'from', 'to', 'afterHours', 'email'],
      properties: {
        condition: { type: 'string', enum: ['sla_breached', 'ticket_priority'] },
        from: audience(true),
        to: audience(false),
        afterHours: { type: 'integer', minimum: 1, maximum: 8760 },
        email: { type: 'boolean' },
      },
    },
  },
};
const policy: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: SERVICE_WORKFLOW_KEYS,
  properties: Object.fromEntries(
    SERVICE_WORKFLOW_KEYS.map((k) => {
      const schema = structuredClone(target);
      if (!k.startsWith('ticket_'))
        (
          (schema.properties!.escalation as SchemaObject).properties!.condition as SchemaObject
        ).enum = ['sla_breached'];
      return [k, schema];
    })
  ),
};
const option: SchemaObject = {
  type: 'array',
  items: {
    type: 'object',
    required: ['id', 'name'],
    properties: { id: { type: 'string' }, name: { type: 'string' } },
  },
};
const view: SchemaObject = {
  type: 'object',
  required: ['policy', 'version', 'roles', 'teams'],
  properties: { policy, version: { type: 'integer', minimum: 0 }, roles: option, teams: option },
};
const schema = z
  .object({
    policy: z.custom<ServiceWorkflowPolicy>(isServiceWorkflowPolicy),
    expectedVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
@ApiTags('Admin service workflows')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/admin/config/service-workflows')
export class ServiceWorkflowController {
  private authorize(req: AuthenticatedRequest) {
    if (
      !hasStaffPermission(req, 'admin:service-targets:edit') ||
      !hasStaffPermission(req, 'admin:service-escalation:edit')
    )
      throw new ForbiddenException();
  }
  @Get()
  @ApiOperation({
    summary: 'Read workflow targets, routing rules and available role/team references',
  })
  @ApiResponse({ status: 200, schema: view })
  read(@Req() req: AuthenticatedRequest) {
    this.authorize(req);
    return readServiceWorkflows();
  }
  @Put()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Replace versioned service targets and escalation rules with recent staff step-up',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['policy', 'expectedVersion'],
      properties: { policy, expectedVersion: { type: 'integer', minimum: 0 } },
    },
  })
  @ApiResponse({ status: 200, schema: view })
  write(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    this.authorize(req);
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new InputFieldException(['policy']);
    return saveServiceWorkflows(
      parsed.data.policy,
      parsed.data.expectedVersion,
      req.session,
      req.ip ?? 'unknown'
    );
  }
}
