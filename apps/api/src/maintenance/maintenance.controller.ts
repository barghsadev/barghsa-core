import {
  Body,
  Controller,
  Get,
  Header,
  HttpException,
  Param,
  Post,
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
import { isStandardMaintenanceNotice } from '@barghsa/i18n/maintenance-public';
import { z } from 'zod';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { RequiresStepUp, StepUpGuard } from '../session/step-up.guard.js';
import {
  MaintenanceService,
  capabilities,
  maintenanceRollbackSchema,
  updateSchema,
} from './maintenance.service.js';
import { InputFieldException } from '../common/input-field.exception.js';

const capabilitySchema = z.enum(capabilities);
const historyCursor = z
  .string()
  .regex(/^[1-9]\d{0,9}$/)
  .transform(Number)
  .pipe(z.number().int().max(2147483647))
  .optional();

@ApiTags('Maintenance')
@Controller('api/maintenance')
export class PublicMaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get()
  @ApiOperation({ summary: 'Current customer-facing maintenance status by capability' })
  @ApiResponse({ status: 200, description: 'Current status for each supported capability' })
  async list() {
    return {
      capabilities: (await this.maintenance.list()).map(
        ({ capability, active, reason, estimatedUntil }) => ({
          capability,
          active,
          reason: isStandardMaintenanceNotice(reason) ? null : reason,
          estimatedUntil,
        })
      ),
    };
  }
}

@ApiTags('Admin · Maintenance')
@ApiBearerAuth()
@Controller('api/admin/maintenance')
@UseGuards(SessionAuthGuard)
export class AdminMaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get()
  @ApiOperation({ summary: 'List capability maintenance flags and responsible owners' })
  @ApiResponse({ status: 200, description: 'Maintenance settings and versions' })
  list(@Req() req: AuthenticatedRequest) {
    if (
      !hasStaffPermission(req, 'admin:config:read') &&
      !hasStaffPermission(req, 'admin:config:write')
    )
      throw new HttpException({ error: 'AUTHZ_FORBIDDEN' }, 403);
    return this.maintenance.list();
  }

  @Get(':capability/history')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Review prior published maintenance settings and the current recovery draft',
  })
  @ApiQuery({ name: 'beforeVersion', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Bounded revision history without private rationale' })
  rollbackHistory(
    @Param('capability') rawCapability: string,
    @Query('beforeVersion') rawBefore: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    if (!hasStaffPermission(req, 'admin:config:write'))
      throw new HttpException({ error: 'AUTHZ_FORBIDDEN' }, 403);
    const capability = capabilitySchema.safeParse(rawCapability);
    const before = historyCursor.safeParse(rawBefore);
    if (!capability.success || !before.success)
      throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    return this.maintenance.rollbackHistory(capability.data, before.data);
  }

  @Post(':capability/rollback-draft')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Copy a prior published maintenance revision into a recovery draft' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['sourceId', 'expectedVersion'],
      additionalProperties: false,
      properties: {
        sourceId: { type: 'string', format: 'uuid' },
        expectedVersion: { type: 'integer', minimum: 0 },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Recovery draft and the active version it is based on' })
  @ApiResponse({
    status: 404,
    description: 'The selected published revision does not belong to this capability',
  })
  @ApiResponse({ status: 409, description: 'The active maintenance version changed' })
  stageRollback(
    @Param('capability') rawCapability: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    if (!hasStaffPermission(req, 'admin:config:write'))
      throw new HttpException({ error: 'AUTHZ_FORBIDDEN' }, 403);
    const capability = capabilitySchema.safeParse(rawCapability);
    const input = maintenanceRollbackSchema.safeParse(body);
    if (!capability.success || !input.success)
      throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    return this.maintenance.stageRollback(
      capability.data,
      input.data,
      req.session,
      req.ip ?? req.socket?.remoteAddress ?? 'unknown'
    );
  }

  @Put(':capability')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Activate or deactivate maintenance for one capability',
    description:
      'A reviewed recovery may include rollbackDraftId for the current capability and version.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['active', 'reason', 'estimatedUntil', 'owner', 'expectedVersion'],
      additionalProperties: false,
      properties: {
        active: { type: 'boolean' },
        reason: {
          type: 'object',
          nullable: true,
          required: ['fa', 'en'],
          additionalProperties: false,
          properties: {
            fa: { type: 'string', maxLength: 500 },
            en: { type: 'string', maxLength: 500 },
          },
        },
        estimatedUntil: { type: 'string', format: 'date-time', nullable: true },
        owner: { type: 'string', maxLength: 100, nullable: true },
        expectedVersion: { type: 'integer', minimum: 0, maximum: 2147483647 },
        publishReason: { type: 'boolean' },
        rollbackDraftId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Updated maintenance setting and version' })
  @ApiResponse({ status: 409, description: 'The setting changed since it was read' })
  update(
    @Param('capability') rawCapability: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    if (!hasStaffPermission(req, 'admin:config:write'))
      throw new HttpException({ error: 'AUTHZ_FORBIDDEN' }, 403);
    const capability = capabilitySchema.safeParse(rawCapability);
    const input = updateSchema.safeParse(body);
    if (!capability.success) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    if (!input.success) {
      const fields = input.error.issues.flatMap((issue) => {
        if (issue.code === 'unrecognized_keys') return [''];
        const root = String(issue.path[0] ?? '');
        if (root === 'reason') {
          if (issue.path[1] === 'fa') return ['reasonFa'];
          if (issue.path[1] === 'en') return ['reasonEn'];
          return issue.path.length === 1 ? ['reasonFa', 'reasonEn'] : [''];
        }
        return [root];
      });
      if (
        fields.length &&
        fields.every((field) =>
          ['active', 'reasonFa', 'reasonEn', 'owner', 'estimatedUntil', 'publishReason'].includes(
            field
          )
        )
      )
        throw new InputFieldException(fields);
      throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    }
    return this.maintenance.update(
      capability.data,
      input.data,
      req.session,
      req.ip ?? req.socket?.remoteAddress ?? 'unknown'
    );
  }
}
