import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ErrorCodes } from '@barghsa/shared/errors'
import type { ContractElectricityLimits } from '@barghsa/shared/admin'
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js'
import { StepUpGuard, RequiresStepUp } from '../session/step-up.guard.js'
import { ContractElectricityLimitsService } from './contract-electricity-limits.service.js'

function httpError(
  code: string,
  message: string,
  statusCode = 400,
  details?: unknown,
): never {
  throw new HttpException(
    { statusCode, error: code, message, ...(details ? { details } : {}) },
    statusCode,
  )
}

function requestIp(req: AuthenticatedRequest): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown'
}

/**
 * Admin endpoints for contract electricity limit configuration
 * (S-09.12, T-09.12.06) — API slice.
 *
 * Three admin-configurable limits, consumed by the electricity ordering
 * flow at draft time (later slices: T-03.06.01.02, T-04.6.01.01):
 *
 *   - `max_quantity_increase_percent` — max % quantity-increase request
 *     on a contracted electricity quantity (0..1000, 0 forbids);
 *   - `max_contract_duration_months` — max advanced-order contract
 *     duration in Jalali months (1..1200);
 *   - `lead_time_days` — min lead time before an advanced order start
 *     (0..36500, 0 = start can be today).
 *
 * Body uses the snake_case wire shape; responses use camelCase. GET
 * returns the documented defaults when nothing is persisted
 * ({ 20, 24, 0 }). Changes affect NEW DRAFTS ONLY — existing contracts
 * and confirmed orders are never re-validated.
 *
 * Security posture (mirrors the S-09.12 admin controllers):
 * - Every route requires an authenticated session with the
 *   `admin:catalogue:edit` capability (same gate as the electricity
 *   ordering settings surface, T-09.10.02). Today the session model
 *   exposes only `req.session.isAdmin` (platform admin); granular
 *   staff-role permissions arrive with the role system (E-10).
 * - The mutation additionally requires recent step-up verification via
 *   `@RequiresStepUp()` (StepUpGuard) — consistent with the VAT and
 *   upload-policy mutation endpoints.
 *
 * The admin web UI slice (number inputs per setting with the
 * "Changes apply to new orders only, not existing contracts." note;
 * fa/en dicts, RTL/a11y) is deferred.
 */
@ApiTags('Admin · Contract Electricity Limits')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/admin/config/contract-electricity-limits')
export class ContractElectricityLimitsController {
  constructor(private readonly service: ContractElectricityLimitsService) {}

  /** Single enforcement point for the `admin:catalogue:edit` capability. */
  private assertElectricitySettingsPermission(req: AuthenticatedRequest): void {
    if (!(req.session.isAdmin ?? false)) {
      httpError(
        ErrorCodes.AUTHZ_FORBIDDEN.code,
        'Admin role required to manage contract electricity limits',
        HttpStatus.FORBIDDEN,
      )
    }
  }

  @Get()
  @ApiOperation({
    summary: 'Get contract electricity limits configuration (admin)',
    description:
      'Current maxQuantityIncreasePercent / maxContractDuration / leadTimeDays. ' +
      'Returns the documented defaults (20, 24 Jalali months, 0 days) when nothing is persisted.',
  })
  @ApiResponse({
    status: 200,
    description: 'Current contract electricity limits.',
    schema: {
      type: 'object',
      required: ['maxQuantityIncreasePercent', 'maxContractDuration', 'leadTimeDays'],
      properties: {
        maxQuantityIncreasePercent: {
          type: 'integer',
          example: 20,
          minimum: 0,
          maximum: 1000,
        },
        maxContractDuration: { type: 'integer', example: 24, minimum: 1, maximum: 1200 },
        leadTimeDays: { type: 'integer', example: 0, minimum: 0, maximum: 36500 },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async get(@Req() req: AuthenticatedRequest): Promise<ContractElectricityLimits> {
    this.assertElectricitySettingsPermission(req)
    return this.service.get()
  }

  @Put()
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Update contract electricity limits configuration (admin)',
    description:
      'Persists new limits. Values: max_quantity_increase_percent (integer 0..1000, 0 forbids ' +
      'increases), max_contract_duration_months (integer 1..1200 Jalali months), lead_time_days ' +
      '(integer 0..36500; 0 = start can be today). Changes apply to new orders/drafts only — ' +
      'existing contracts are never re-validated.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['max_quantity_increase_percent', 'max_contract_duration_months', 'lead_time_days'],
      properties: {
        max_quantity_increase_percent: { type: 'integer', example: 20, minimum: 0, maximum: 1000 },
        max_contract_duration_months: { type: 'integer', example: 24, minimum: 1, maximum: 1200 },
        lead_time_days: { type: 'integer', example: 0, minimum: 0, maximum: 36500 },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Contract electricity limits updated.',
    schema: {
      type: 'object',
      properties: {
        maxQuantityIncreasePercent: { type: 'integer' },
        maxContractDuration: { type: 'integer' },
        leadTimeDays: { type: 'integer' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async update(
    @Req() req: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ): Promise<ContractElectricityLimits> {
    this.assertElectricitySettingsPermission(req)
    return this.service.update({
      raw: body,
      actorUserId: req.session.userId,
      ip: requestIp(req),
    })
  }
}