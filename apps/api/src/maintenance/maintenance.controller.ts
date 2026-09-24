import { Body, Controller, Get, HttpException, Param, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { RequiresStepUp, StepUpGuard } from '../session/step-up.guard.js';
import { MaintenanceService, capabilities, updateSchema } from './maintenance.service.js';

const capabilitySchema = z.enum(capabilities);

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
          reason,
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

  @Put(':capability')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Activate or deactivate maintenance for one capability' })
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
    if (!capability.success || !input.success)
      throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    return this.maintenance.update(
      capability.data,
      input.data,
      req.session,
      req.ip ?? req.socket?.remoteAddress ?? 'unknown'
    );
  }
}
