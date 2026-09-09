import { Body, Controller, Get, HttpException, Put, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
  type ApiResponseOptions,
} from '@nestjs/swagger';
import { ErrorCodes } from '@barghsa/shared/errors';
import { SERVICE_DUE_PERIOD_TYPES } from '@barghsa/shared/finance';
import { randomUUID } from 'node:crypto';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { StepUpGuard, RequiresStepUp } from '../session/step-up.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import {
  ServiceDuePeriodService,
  SERVICE_DUE_PERIOD_PERMISSION,
} from './service-due-period.service.js';

const settingsResponse: ApiResponseOptions = {
  status: 200,
  description: 'Four current settings; missing periods use seven days.',
  schema: {
    type: 'array',
    minItems: 4,
    maxItems: 4,
    items: {
      type: 'object',
      required: ['serviceType', 'defaultDays', 'periodId', 'effectiveFrom', 'effectiveUntil'],
      properties: {
        serviceType: { type: 'string', enum: [...SERVICE_DUE_PERIOD_TYPES] },
        defaultDays: { type: 'integer', minimum: 1, maximum: 365 },
        periodId: { type: 'string', format: 'uuid', nullable: true },
        effectiveFrom: { type: 'string', format: 'date-time', nullable: true },
        effectiveUntil: { type: 'string', format: 'date-time', nullable: true },
      },
    },
  },
};

@ApiTags('Admin · Invoice due periods')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, StepUpGuard)
@Controller('api/admin/config/invoice-due-periods')
export class ServiceDuePeriodController {
  constructor(private readonly service: ServiceDuePeriodService) {}

  private authorize(req: AuthenticatedRequest) {
    if (!hasStaffPermission(req, SERVICE_DUE_PERIOD_PERMISSION))
      throw new HttpException({ error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
  }

  @Get()
  @ApiOperation({ summary: 'Read current default invoice due days by service type' })
  @ApiResponse(settingsResponse)
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Finance configuration permission required' })
  async list(@Req() req: AuthenticatedRequest) {
    this.authorize(req);
    return this.service.list(req.session);
  }

  @Put()
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Version a default invoice due period',
    description:
      'Takes effect now. Existing invoices and future configured periods keep their values. Requires current finance configuration permission and recent step-up.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['serviceType', 'defaultDays', 'expectedPeriodId'],
      properties: {
        serviceType: { type: 'string', enum: [...SERVICE_DUE_PERIOD_TYPES] },
        defaultDays: { type: 'integer', minimum: 1, maximum: 365 },
        expectedPeriodId: { type: 'string', format: 'uuid', nullable: true },
      },
    },
  })
  @ApiResponse(settingsResponse)
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 400, description: 'Invalid service type, days or version.' })
  @ApiResponse({
    status: 403,
    description: 'Missing finance configuration permission, CSRF or step-up.',
  })
  @ApiResponse({ status: 409, description: 'The current period changed. Reload before saving.' })
  async set(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    this.authorize(req);
    return this.service.set(
      body,
      req.session,
      req.ip ?? 'unknown',
      correlationIdStorage.getStore() ?? randomUUID()
    );
  }
}
